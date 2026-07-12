#!/usr/bin/env gjs -m
/**
 * shade-shell — Share Picker for XDPH
 *
 * Live-ish screen preview picker for xdg-desktop-portal-hyprland.
 * Polls grim every ~200ms per monitor for live thumbnails.
 * Captures window snapshots via grim -g on tab switch.
 *
 * Protocol:
 *   Env: XDPH_WINDOW_SHARING_LIST = "ID[HC>]CLASS[HT>]TITLE[HE>]ADDR[HA>] ..."
 *   Args: --allow-token
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import {programArgs} from 'system';

// ── Constants ────────────────────────────────────────────────────

const GRIM_BIN = 'grim';
// eslint-disable-next-line sonarjs/publicly-writable-directories
const TEMP_DIR = '/tmp/dshell-picker';
const POLL_INTERVAL_MS = 200; // stagger per monitor — each monitor captured every N×monitorCount ms

// ── Types ────────────────────────────────────────────────────────

interface XDPHWindow {
    id: string;
    clazz: string;
    title: string;
    address: string;
}

interface HyprMonitor {
    name: string;
    description: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Shared source state — referenced by picture widgets across tabs */
interface SourceState<S, T> {
    info: S;
    kind: T;
    /** Primary texture (shared by all Picture widgets for this source) */
    texture: Gdk.Texture | null;
    /** Whether a grim capture is currently in-flight */
    capturing: boolean;
    /** Index into extraPictures[] for the combined tab */
    combinedIdx: number;
}

interface MonitorState extends SourceState<HyprMonitor, 'monitor'> {
    kind: 'monitor';
}

interface WindowState extends SourceState<XDPHWindow, 'window'> {
    kind: 'window';
    geometry: { x: number; y: number; width: number; height: number } | null;
}


// ── Sync command helpers ─────────────────────────────────────────

function runCapture(cmd: string[], onDone: (ok: boolean) => void): void {
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.wait_check_async(null, () => onDone(proc.get_successful()));
    } catch {
        onDone(false);
    }
}

function runSync(cmd: string[]): { ok: boolean; out: string; err: string } {
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [, out, err] = proc.communicate_utf8(null);
        return {ok: proc.get_successful(), out: out?.trim() ?? '', err: err?.trim() ?? ''};
    } catch (e) {
        return {ok: false, out: '', err: String(e)};
    }
}

// ── XDPH env parsing ────────────────────────────────────────────

function parseWindowList(env: string | null): XDPHWindow[] {
    if (!env) return [];
    const result: XDPHWindow[] = [];
    let remaining = env;

    while (remaining.length > 0) {
        const idSep = remaining.indexOf('[HC>]');
        if (idSep === -1) break;
        const id = remaining.substring(0, idSep);

        const classSep = remaining.indexOf('[HT>]', idSep);
        if (classSep === -1) break;
        const clazz = remaining.substring(idSep + 5, classSep);

        const titleSep = remaining.indexOf('[HE>]', classSep);
        if (titleSep === -1) break;
        const title = remaining.substring(classSep + 5, titleSep);

        const addrSep = remaining.indexOf('[HA>]', titleSep);
        const endSep = remaining.indexOf(' ', titleSep + 5);
        const effectiveEnd = endSep === -1 ? remaining.length : endSep;

        let address = '';
        if (addrSep !== -1 && addrSep < effectiveEnd) {
            address = remaining.substring(addrSep + 5, effectiveEnd);
        }

        result.push({id, clazz, title, address});
        remaining = remaining.substring(effectiveEnd + 1);
    }

    return result;
}

// ── hyprctl helpers ──────────────────────────────────────────────

function getHyprMonitors(): HyprMonitor[] {
    const {ok, out} = runSync(['hyprctl', '-j', 'monitors']);
    if (!ok) return [];
    try {
        const raw = JSON.parse(out);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (raw as any[]).map(m => ({
            name: m.name ?? 'Unknown',
            description: m.description ?? m.name ?? '',
            x: m.x ?? 0,
            y: m.y ?? 0,
            width: m.width ?? 0,
            height: m.height ?? 0,
        }));
    } catch {
        return [];
    }
}

function getHyprClientMap(): Map<string, {at: [number, number]; size: [number, number]}> {
    const {ok, out} = runSync(['hyprctl', '-j', 'clients']);
    if (!ok) return new Map();
    try {
        const raw = JSON.parse(out);
        const result = new Map<string, {at: [number, number]; size: [number, number]}>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of raw as any[]) {
            if (c.mapped && !c.hidden && c.at && c.size) {
                result.set(c.address, {at: c.at, size: c.size});
            }
        }
        return result;
    } catch {
        return new Map();
    }
}

// ── Temp files ───────────────────────────────────────────────────

function ensureTempDir(): void {
    try { GLib.mkdir_with_parents(TEMP_DIR, 0o755); } catch { /* ignore */ }
}

function monPath(name: string): string {
    return `${TEMP_DIR}/mon-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
}
function winPath(addr: string): string {
    const safe = addr.replace(/^0x/, '').replace(/[^a-fA-F0-9]/g, '');
    return `${TEMP_DIR}/win-${safe}.png`;
}

// ── Card builder ─────────────────────────────────────────────────

const PICTURE_W = 240;
const PICTURE_H = 135;

function makePicture(): Gtk.Picture {
    const pic = new Gtk.Picture();
    pic.set_size_request(PICTURE_W, PICTURE_H);
    pic.content_fit = Gtk.ContentFit.SCALE_DOWN;
    pic.add_css_class('picker-preview');
    return pic;
}

/**
 * Build one thumbnail card and add it to `flow`.
 * Returns the picture widget and button for later updates.
 */
function buildCard(
    flow: Gtk.FlowBox,
    labelText: string,
    subText: string,
    pic: Gtk.Picture,
    onClick: () => void,
): Gtk.Button {
    const label = new Gtk.Label({
        label: labelText,
        xalign: 0.5,
        cssClasses: ['picker-label'],
        ellipsize: 3, // Pango.EllipsizeMode.END
    });

    const inner = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        cssClasses: ['picker-card'],
    });
    inner.append(pic);
    inner.append(label);

    if (subText) {
        const sub = new Gtk.Label({
            label: subText,
            xalign: 0.5,
            cssClasses: ['picker-sublabel'],
            ellipsize: 3,
        });
        inner.append(sub);
    }

    const button = new Gtk.Button({child: inner, cssClasses: ['flat']});
    button.connect('clicked', onClick);

    flow.append(new Gtk.FlowBoxChild({child: button}));
    return button;
}

/** Build a label header for sections within a flow box */
function buildSectionLabel(text: string): Gtk.Label {
    const l = new Gtk.Label({
        label: text,
        cssClasses: ['picker-section'],
        halign: Gtk.Align.START,
    });
    l.set_margin_top(8);
    return l;
}

// ── Texture loading ──────────────────────────────────────────────

function loadTexture(path: string, picture: Gtk.Picture): void {
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
        try {
            const tex = Gdk.Texture.new_from_filename(path);
            picture.set_paintable(tex);
        } catch {
            // ignore corrupt files
        }
    }
}

function loadTextureAll(path: string, pictures: Gtk.Picture[]): void {
    if (pictures.length === 0) return;
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
        try {
            const tex = Gdk.Texture.new_from_filename(path);
            for (const pic of pictures) {
                pic.set_paintable(tex);
            }
        } catch {
            // ignore
        }
    }
}

// ── Capture functions ────────────────────────────────────────────

function captureMonitor(
    state: MonitorState,
    pictures: Gtk.Picture[],
): void {
    if (state.capturing) return;
    state.capturing = true;
    const path = monPath(state.info.name);
    runCapture([GRIM_BIN, '-o', state.info.name, path], ok => {
        state.capturing = false;
        if (ok) {
            state.texture = Gdk.Texture.new_from_filename(path);
            loadTextureAll(path, pictures);
        }
    });
}

function captureWindow(
    state: WindowState,
    pictures: Gtk.Picture[],
): void {
    if (!state.geometry || state.capturing) return;
    state.capturing = true;
    const g = state.geometry;
    const path = winPath(state.xdph.address);
    runCapture([GRIM_BIN, '-g', `${g.x},${g.y} ${g.width}x${g.height}`, path], ok => {
        state.capturing = false;
        if (ok) {
            state.texture = Gdk.Texture.new_from_filename(path);
            loadTextureAll(path, pictures);
        }
    });
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
    // Parse args
    let allowTokenDefault = false;
    for (const arg of programArgs) {
        if (arg === '--allow-token') allowTokenDefault = true;
    }

    const windowListStr = GLib.getenv('XDPH_WINDOW_SHARING_LIST');
    const xdphWindows = parseWindowList(windowListStr);

    const app = new Gtk.Application({
        applicationId: 'com.caioasmuniz.shade_shell.share_picker',
        flags: 0,
    });

    let tokenRestore = allowTokenDefault;

    /** Print selection and quit — XDPH reads stdout */
    function select(value: string): void {
        print(value);
        app.quit();
    }

    // ── Activate ──────────────────────────────────────────────
    app.connect('activate', () => {
        ensureTempDir();

        // Fetch Hyprland info
        const hyprMonitors = getHyprMonitors();
        const clientGeoms = getHyprClientMap();

        // Build source states
        const monitorStates: MonitorState[] = hyprMonitors.map(m => ({
            kind: 'monitor' as const,
            info: m,
            texture: null,
            capturing: false,
            combinedIdx: -1,
        }));

        // Match XDPH windows to hyprctl client geometries
        const windowStates: WindowState[] = [];
        // Sort: unmapped / no-geometry last
        const sortedXDPH = [...xdphWindows].sort((a, b) => {
            const aGeom = a.address && clientGeoms.has(a.address);
            const bGeom = b.address && clientGeoms.has(b.address);
            if (aGeom && !bGeom) return -1;
            if (!aGeom && bGeom) return 1;
            return 0;
        });
        for (const w of sortedXDPH) {
            let geometry: WindowState['geometry'] = null;
            if (w.address && clientGeoms.has(w.address)) {
                const g = clientGeoms.get(w.address)!;
                geometry = {x: g.at[0], y: g.at[1], width: g.size[0], height: g.size[1]};
            }
            windowStates.push({
                kind: 'window' as const,
                info: w,
                xdph: w,
                geometry,
                texture: null,
                capturing: false,
                combinedIdx: -1,
            });
        }

        // ── Build UI ────────────────────────────────────────
        const win = new Gtk.Window({
            application: app,
            title: 'Share Screen / Window',
            defaultWidth: 720,
            defaultHeight: 520,
            resizable: true,
            hideOnClose: true,
        });

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            marginTop: 12,
            marginBottom: 12,
            marginStart: 12,
            marginEnd: 12,
        });

        // Header
        const header = new Gtk.Label({
            label: 'Select what to share',
            cssClasses: ['title-2'],
            halign: Gtk.Align.START,
        });
        mainBox.append(header);

        // Notebook (tabs)
        const notebook = new Gtk.Notebook();
        notebook.set_scrollable(true);

        // ─── Tab 1: Screens ─────────────────────────────────
        const screensFlow = new Gtk.FlowBox({
            minChildrenPerLine: 2,
            maxChildrenPerLine: 4,
            selectionMode: Gtk.SelectionMode.NONE,
            columnSpacing: 8,
            rowSpacing: 8,
            homogeneous: true,
            hexpand: true,
        });
        const screensScroll = new Gtk.ScrolledWindow({
            child: screensFlow,
            hexpand: true,
            vexpand: true,
        });

        // Build monitor cards
        const monitorPics: Gtk.Picture[] = [];
        if (monitorStates.length === 0) {
            screensFlow.append(new Gtk.FlowBoxChild({
                child: new Gtk.Label({label: 'No monitors found'}),
            }));
        } else {
            for (const state of monitorStates) {
                const pic = makePicture();
                monitorPics.push(pic);
                buildCard(
                    screensFlow,
                    state.info.description || state.info.name,
                    `${state.info.width}×${state.info.height} — ${state.info.name}`,
                    pic,
                    () => select(`[SELECTION]${tokenRestore ? 'r' : ''}/screen:${state.info.name}`),
                );
            }
        }
        notebook.append_page(screensScroll, new Gtk.Label({label: 'Screens'}));

        // ─── Tab 2: Windows ─────────────────────────────────
        const windowsFlow = new Gtk.FlowBox({
            minChildrenPerLine: 2,
            maxChildrenPerLine: 4,
            selectionMode: Gtk.SelectionMode.NONE,
            columnSpacing: 8,
            rowSpacing: 8,
            homogeneous: true,
            hexpand: true,
        });
        const windowsScroll = new Gtk.ScrolledWindow({
            child: windowsFlow,
            hexpand: true,
            vexpand: true,
        });

        const windowPics: Gtk.Picture[] = [];
        if (windowStates.length === 0) {
            windowsFlow.append(new Gtk.FlowBoxChild({
                child: new Gtk.Label({label: 'No windows available'}),
            }));
        } else {
            for (const state of windowStates) {
                const pic = makePicture();
                windowPics.push(pic);

                const btn = buildCard(
                    windowsFlow,
                    state.xdph.clazz || state.xdph.title,
                    state.geometry
                        ? `${state.geometry.width}×${state.geometry.height}`
                        : 'No preview (hidden or off-screen)',
                    pic,
                    () => select(`[SELECTION]${tokenRestore ? 'r' : ''}/window:${state.xdph.id}`),
                );

                // Disable button if no geometry (can't capture)
                if (!state.geometry) {
                    btn.sensitive = false;
                }
            }
        }
        notebook.append_page(windowsScroll, new Gtk.Label({label: 'Windows'}));

        // ─── Tab 3: Screens & Windows ───────────────────────
        const combinedBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
        });

        // Monitors section
        combinedBox.append(buildSectionLabel('Screens'));
        const combinedMonFlow = new Gtk.FlowBox({
            minChildrenPerLine: 2,
            maxChildrenPerLine: 4,
            selectionMode: Gtk.SelectionMode.NONE,
            columnSpacing: 8,
            rowSpacing: 8,
            homogeneous: true,
            hexpand: true,
        });
        const combinedMonPics: Gtk.Picture[] = [];
        if (monitorStates.length > 0) {
            for (const state of monitorStates) {
                const pic = makePicture();
                combinedMonPics.push(pic);
                buildCard(
                    combinedMonFlow,
                    state.info.description || state.info.name,
                    `${state.info.width}×${state.info.height}`,
                    pic,
                    () => select(`[SELECTION]${tokenRestore ? 'r' : ''}/screen:${state.info.name}`),
                );
            }
        }
        combinedBox.append(combinedMonFlow);

        // Windows section
        combinedBox.append(buildSectionLabel('Windows'));
        const combinedWinFlow = new Gtk.FlowBox({
            minChildrenPerLine: 2,
            maxChildrenPerLine: 4,
            selectionMode: Gtk.SelectionMode.NONE,
            columnSpacing: 8,
            rowSpacing: 8,
            homogeneous: true,
            hexpand: true,
        });
        const combinedWinPics: Gtk.Picture[] = [];
        if (windowStates.length > 0) {
            for (const state of windowStates) {
                const pic = makePicture();
                combinedWinPics.push(pic);
                const btn = buildCard(
                    combinedWinFlow,
                    state.xdph.clazz || state.xdph.title,
                    state.geometry ? `${state.geometry.width}×${state.geometry.height}` : 'No preview',
                    pic,
                    () => select(`[SELECTION]${tokenRestore ? 'r' : ''}/window:${state.xdph.id}`),
                );
                if (!state.geometry) btn.sensitive = false;
            }
        }
        combinedBox.append(combinedWinFlow);

        const combinedScroll = new Gtk.ScrolledWindow({
            child: combinedBox,
            hexpand: true,
            vexpand: true,
        });
        notebook.append_page(combinedScroll, new Gtk.Label({label: 'All'}));

        mainBox.append(notebook);

        // ── Token restore checkbox ──────────────────────────
        const tokenBox = new Gtk.CheckButton({
            label: 'Allow restore token',
            active: tokenRestore,
        });
        tokenBox.connect('toggled', () => {
            tokenRestore = tokenBox.active;
        });
        mainBox.append(tokenBox);

        // ── Cancel ──────────────────────────────────────────
        const cancelBtn = new Gtk.Button({
            label: 'Cancel',
            halign: Gtk.Align.CENTER,
        });
        cancelBtn.connect('clicked', () => app.quit());
        mainBox.append(cancelBtn);

        win.connect('close-request', () => app.quit());
        win.set_child(mainBox);
        win.present();

        // ── Capture logic ──────────────────────────────────────

        let screenPollTimer = 0;
        let pollIndex = 0;

        function pollMonitorsTick(): boolean {
            if (monitorStates.length === 0) return GLib.SOURCE_CONTINUE;
            captureMonitor(monitorStates[pollIndex], monitorPics);
            // Also update combined tab pictures if they exist
            if (combinedMonPics.length > pollIndex) {
                const path = monPath(monitorStates[pollIndex].info.name);
                loadTexture(path, combinedMonPics[pollIndex]);
            }
            pollIndex = (pollIndex + 1) % monitorStates.length;
            return GLib.SOURCE_CONTINUE;
        }

        function startPolling(): void {
            if (screenPollTimer) return;
            pollIndex = 0;
            screenPollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, pollMonitorsTick);
        }

        function stopPolling(): void {
            if (screenPollTimer) {
                GLib.source_remove(screenPollTimer);
                screenPollTimer = 0;
            }
        }

        function captureAllWindows(): void {
            for (let i = 0; i < windowStates.length; i++) {
                const state = windowStates[i];
                if (state.geometry) {
                    captureWindow(state, [windowPics[i]]);
                    // Also fill combined tab
                    if (combinedWinPics.length > i) {
                        const path = winPath(state.xdph.address);
                        loadTexture(path, combinedWinPics[i]);
                    }
                }
            }
        }

        // ── Tab switch handler ──────────────────────────────
        notebook.connect('switch-page', (_nb, _page, pageNum: number) => {
            stopPolling();
            if (pageNum === 0) {
                // Screens tab — start live polling
                startPolling();
            } else if (pageNum === 1) {
                // Windows tab — capture all windows once
                captureAllWindows();
            } else if (pageNum === 2) {
                // Combined tab — capture monitors once, windows once
                // Monitors: single capture for each
                for (let i = 0; i < monitorStates.length; i++) {
                    const path = monPath(monitorStates[i].info.name);
                    runCapture([GRIM_BIN, '-o', monitorStates[i].info.name, path], (ok) => {
                        if (ok) loadTexture(path, combinedMonPics[i]);
                    });
                }
                // Windows: single capture
                for (let i = 0; i < windowStates.length; i++) {
                    const state = windowStates[i];
                    if (state.geometry) {
                        const path = winPath(state.xdph.address);
                        runCapture(
                            [GRIM_BIN, '-g', `${state.geometry.x},${state.geometry.y} ${state.geometry.width}x${state.geometry.height}`, path],
                            (ok) => {
                                if (ok) loadTexture(path, combinedWinPics[i]);
                            },
                        );
                    }
                }
            }
        });

        // ── Initial capture — fire once so previews aren't blank ─
        for (let i = 0; i < monitorStates.length; i++) {
            captureMonitor(monitorStates[i], monitorPics);
        }
        // ── Start polling on initial tab (Screens) ──────────
        startPolling();
    });

    // ── Shutdown ────────────────────────────────────────────
    app.connect('shutdown', () => {
        // Clean up temp files
        try {
            const dir = Gio.File.new_for_path(TEMP_DIR);
            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info = enumerator.next_file(null);
            while (info) {
                const child = dir.get_child(info.get_name());
                child.delete(null);
                info = enumerator.next_file(null);
            }
        } catch {
            // ignore cleanup failures
        }
    });

    app.run([]);
}

main();
