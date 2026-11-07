/**
 * shade-shell — Share Picker for XDPH
 *
 * Live-ish screen preview picker for xdg-desktop-portal-hyprland.
 * Polls grim every ~200ms per monitor for live thumbnails.
 * Captures window snapshots via grim -g on tab switch.
 *
 *   Env: XDPH_SESSION_HANDLE = ".../session/1_502/token" (XDPH portal launches only)
 *   Env: XDPH_WINDOW_SHARING_LIST = "ID[HC>]CLASS[HT>]TITLE[HE>]..."
 *   Args: --allow-token
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {programArgs} from 'system';
import './picker.css'; // auto-loaded as CssProvider by gnim dev/bundle
import logger from '@shade/core/logger';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {initSettingsRoot} from '@shade/core/settingsRegistry';
import printOut from '@shade/core/stdout';
import {ColorScheme} from '@shade/services/display/colorScheme';
import {applyDefaultAdwaitaPalette} from '@shade/services/theme/adwaitaPalette';
import {captureMonitor, captureWindow, cleanTempDir, ensureTempDir, GRIM_BIN} from './capture';
import {MonitorPoller} from './poller';
import {getHyprClients, getHyprMonitors, HYPRCTL_BIN, parseWindowList} from './protocol';
import {buildSources} from './sources';
import type {MonitorState, ParsedWindowList, PreviewHandle, SelectFn, WindowState} from './types';
import {buildCombinedTab, buildScreensTab, buildWindowsTab, type CombinedTab, type Tab} from './ui';

const CAT = 'share-picker';
const APP_ID = 'com.caioasmuniz.shade_shell.share_picker';

/** Mutable holder so the token checkbox and the select fn share state. */
interface TokenState {
    value: boolean;
}

interface PickerUi {
    win: Gtk.Window;
    notebook: Gtk.Notebook;
    screensTab: Tab;
    windowsTab: Tab;
    combinedTab: CombinedTab;
}

function makeSelectFn(app: Gtk.Application, token: TokenState): SelectFn {
    return (kind, id) => {
        try {
            printOut(`[SELECTION]${token.value ? 'r' : ''}/${kind}:${id}`);
        } catch (e) {
            logger.error(CAT, `select: print failed for ${kind}:${id}`, e);
            throw e;
        }
        try {
            app.quit();
        } catch (e) {
            logger.error(CAT, 'select: app.quit failed', e);
        }
    };
}

function logSources(monitors: MonitorState[], windows: WindowState[]): void {
    logger.info(CAT, `${monitors.length} monitors loaded, ${windows.length} windows loaded`);
    for (const m of monitors) {
        logger.info(
            CAT,
            `  monitor: ${m.info.name} ${m.info.width}x${m.info.height} @ (${m.info.x},${m.info.y})`
        );
    }
    for (const w of windows) {
        const geo = w.geometry ? `${w.geometry.width}x${w.geometry.height}` : 'none';
        logger.info(CAT, `  window: ${w.info.clazz} geo=${geo}`);
    }
}

function buildPicker(
    app: Gtk.Application,
    token: TokenState,
    select: SelectFn,
    monitors: MonitorState[],
    windows: WindowState[],
    windowListProvided: boolean
): PickerUi {
    const win = new Gtk.Window({
        application: app,
        title: 'Escolha o que compartilhar',
        defaultWidth: 760,
        defaultHeight: 600,
        resizable: true,
        decorated: true,
        hideOnClose: false,
        cssClasses: ['picker-popup', 'background'],
    });

    const mainBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        marginTop: 12,
        marginBottom: 12,
        marginStart: 12,
        marginEnd: 12,
    });

    const heading = new Gtk.Label({
        label: 'Escolha o que compartilhar',
        cssClasses: ['title-2'],
        halign: Gtk.Align.START,
        hexpand: true,
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        maxWidthChars: 70,
        lines: 2,
        ellipsize: Pango.EllipsizeMode.END,
    });
    mainBox.append(heading);
    const explanation = new Gtk.Label({
        label: 'Inspecionar a prévia não autoriza compartilhamento.',
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        maxWidthChars: 70,
        xalign: 0,
    });
    mainBox.append(explanation);
    heading.tooltipText = heading.label;
    const notebook = new Gtk.Notebook({vexpand: true, hexpand: true});
    notebook.set_scrollable(true);
    let pending: {kind: 'screen' | 'window'; id: string} | null = null;
    const reviewBody = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
    const review = new Gtk.ScrolledWindow({
        child: reviewBody,
        visible: false,
        hexpand: true,
        vexpand: true,
        hscrollbarPolicy: Gtk.PolicyType.NEVER,
        vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
        propagateNaturalHeight: false,
        propagateNaturalWidth: false,
    });
    // This is the preview's content size, not the viewport's minimum height.
    const picture = new Gtk.Picture({heightRequest: 180, canShrink: true});
    const summary = new Gtk.Label({
        wrap: true,
        wrapMode: Pango.WrapMode.WORD_CHAR,
        lines: 3,
        ellipsize: Pango.EllipsizeMode.END,
        maxWidthChars: 60,
        xalign: 0,
        selectable: true,
    });
    const confirm = new Gtk.Button({
        label: 'Compartilhar',
        sensitive: false,
        cssClasses: ['suggested-action'],
    });
    let submitted = false;
    const reset = () => {
        pending = null;
        picture.paintable = null;
        review.visible = false;
        notebook.visible = true;
        confirm.sensitive = false;
        heading.label = 'Escolha o que compartilhar';
        heading.tooltipText = heading.label;
        explanation.label = 'Inspecionar a prévia não autoriza compartilhamento.';
    };
    const choose: SelectFn = (kind, id) => {
        const monitor = monitors.find((source) => source.info.name === id);
        const window = windows.find((source) => source.info.id === id);
        if (kind === 'screen' ? !monitor : !window) return;
        pending = {kind, id};
        picture.paintable =
            kind === 'screen' ? (monitor?.texture ?? null) : (window?.texture ?? null);
        summary.label =
            kind === 'screen'
                ? `${monitor?.info.description || id}\nTela inteira; outras janelas visíveis também podem ser expostas.`
                : `${window?.info.title || id}\n${window?.info.clazz || ''}`;
        summary.tooltipText = summary.label;
        heading.label = kind === 'screen' ? 'Revise a tela escolhida' : 'Revise a janela escolhida';
        heading.tooltipText = `${kind === 'screen' ? 'Revise a tela escolhida' : 'Revise a janela escolhida'}: ${summary.label}`;
        explanation.label =
            'A prévia pode estar indisponível; a fonte só será enviada após Compartilhar. O aplicativo solicitante controla o início da transmissão.';
        confirm.sensitive = true;
        notebook.visible = false;
        review.visible = true;
    };
    reviewBody.append(picture);
    reviewBody.append(summary);
    const change = new Gtk.Button({label: 'Escolher outra fonte', halign: Gtk.Align.START});
    change.connect('clicked', reset);
    reviewBody.append(change);
    const screensTab = buildScreensTab(monitors, choose);
    notebook.append_page(screensTab.page, new Gtk.Label({label: 'Telas'}));
    const windowsTab = buildWindowsTab(windows, choose, windowListProvided);
    notebook.append_page(windowsTab.page, new Gtk.Label({label: 'Janelas'}));
    const combinedTab = buildCombinedTab(monitors, windows, choose, windowListProvided);
    notebook.append_page(combinedTab.page, new Gtk.Label({label: 'Todas as fontes'}));
    // Each tab owns a real vertical scroll viewport, including empty combined
    // sections. Keep its content's natural size out of the window minimum.
    // All chooser pages are true vertical viewports, so empty combined state
    // messages below a large screen section remain reachable by scrolling.
    for (const page of [screensTab.page, windowsTab.page, combinedTab.page]) {
        if (page instanceof Gtk.ScrolledWindow) {
            page.hexpand = true;
            page.vexpand = true;
            page.hscrollbarPolicy = Gtk.PolicyType.NEVER;
            page.vscrollbarPolicy = Gtk.PolicyType.AUTOMATIC;
            page.propagateNaturalHeight = false;
            page.propagateNaturalWidth = false;
            page.minContentHeight = 0;
            page.minContentWidth = 0;
        }
    }

    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, vexpand: true});
    body.append(notebook);
    body.append(review);
    mainBox.append(body);

    // ── Token restore checkbox ──────────────────────────
    const tokenBox = new Gtk.CheckButton({
        label: 'Permitir token de restauração',
        active: token.value,
        visible: token.value || programArgs.includes('--allow-token'),
    });
    tokenBox.connect('toggled', () => {
        token.value = tokenBox.active;
    });
    const footer = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, hexpand: true});
    footer.append(tokenBox);
    footer.append(
        new Gtk.Label({
            label: 'O token pertence a este pedido; não salva uma preferência do shell.',
            wrap: true,
            wrapMode: Pango.WrapMode.WORD_CHAR,
            maxWidthChars: 70,
            xalign: 0,
            cssClasses: ['caption', 'dim-label'],
        })
    );
    const actions = new Gtk.Box({spacing: 12, halign: Gtk.Align.END});
    const back = new Gtk.Button({label: 'Voltar'});
    back.connect('clicked', reset);
    actions.append(back);
    const cancelBtn = new Gtk.Button({label: 'Cancelar'});
    cancelBtn.connect('clicked', () => app.quit());
    actions.append(cancelBtn);
    confirm.connect('clicked', () => {
        if (!pending || submitted) return;
        const {kind, id} = pending;
        const source = windows.find((item) => item.info.id === id);
        const exists =
            kind === 'screen'
                ? getHyprMonitors().some((item) => item.name === id)
                : getHyprClients().some((item) => {
                      if (!item.mapped || item.hidden) return false;
                      if (source?.hyprAddress) return item.address === source.hyprAddress;
                      return (
                          !!source &&
                          item.class === source.info.clazz &&
                          item.title === source.info.title
                      );
                  });
        if (!exists) {
            reset();
            explanation.label = 'A fonte não está mais disponível. Escolha outra fonte ou cancele.';
            return;
        }
        submitted = true;
        confirm.sensitive = false;
        try {
            select(kind, id);
        } catch {
            submitted = false;
            confirm.sensitive = true;
            explanation.label =
                'Não foi possível enviar a escolha ao portal. Tente novamente ou cancele.';
        }
    });
    actions.append(confirm);
    footer.append(actions);
    mainBox.append(footer);

    GObject.signal_connect(win, 'close-request', () => app.quit());
    win.set_child(mainBox);

    return {win, notebook, screensTab, windowsTab, combinedTab};
}

function setupCapture(ui: PickerUi, monitors: MonitorState[], windows: WindowState[]): () => void {
    const {screensTab, windowsTab, combinedTab, notebook} = ui;
    const monitorTargets = monitors.map((_, index) =>
        [screensTab.previews[index], combinedTab.monitorPreviews[index]].filter(
            (handle): handle is PreviewHandle => handle !== undefined
        )
    );
    const windowTargets = windows.map((_, index) =>
        [windowsTab.previews[index], combinedTab.windowPreviews[index]].filter(
            (handle): handle is PreviewHandle => handle !== undefined
        )
    );
    const poller = new MonitorPoller(monitors, monitorTargets);
    const switched = notebook.connect('switch-page', (_notebook, _page, pageNum: number) => {
        poller.stop();
        if (pageNum === 0) {
            poller.start();
        } else {
            if (pageNum === 2) {
                monitors.forEach((state, index) => captureMonitor(state, monitorTargets[index]));
            }
            windows.forEach((state, index) => captureWindow(state, windowTargets[index]));
        }
    });
    monitors.forEach((state, index) => captureMonitor(state, monitorTargets[index]));
    poller.start();
    return () => {
        poller.stop();
        if (GObject.signal_handler_is_connected(notebook, switched)) notebook.disconnect(switched);
        for (const targets of [...monitorTargets, ...windowTargets]) {
            for (const handle of targets) handle.dispose();
        }
    };
}

function onActivate(
    app: Gtk.Application,
    token: TokenState,
    select: SelectFn,
    windowList: ParsedWindowList
): () => void {
    Adw.init();
    initSettingsRoot();
    ColorScheme.get_default().init(generalSettings());
    applyDefaultAdwaitaPalette();
    ensureTempDir();

    logger.debug(
        CAT,
        `XDPH_WINDOW_SHARING_LIST=${GLib.getenv('XDPH_WINDOW_SHARING_LIST') || '(null)'}`
    );
    logger.debug(CAT, `GRIM_BIN=${GRIM_BIN}, HYPRCTL_BIN=${HYPRCTL_BIN}`);
    if (!GRIM_BIN.includes('/')) logger.warn(CAT, 'grim not found in PATH, previews unavailable');
    if (!HYPRCTL_BIN.includes('/'))
        logger.warn(CAT, 'hyprctl not found in PATH, monitors/windows will be empty');

    const {monitors, windows} = buildSources(windowList.windows);
    logSources(monitors, windows);

    const ui = buildPicker(app, token, select, monitors, windows, windowList.provided);
    ui.win.present();
    return setupCapture(ui, monitors, windows);
}

function requesterNameFromSessionHandle(handle: string | null): string | null {
    if (!handle) return null;
    const match = handle.match(
        /^\/org\/freedesktop\/portal\/desktop\/session\/([0-9]+(?:_[0-9]+)+)\/[^/]+$/
    );
    if (!match) return null;
    return `:${match[1].replaceAll('_', '.')}`;
}

function watchPortalRequester(
    app: Gtk.Application,
    owner: string,
    setOwnerAlive: (alive: boolean) => void
): number {
    const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    let awaitingOwner = true;
    app.hold();
    return Gio.bus_watch_name_on_connection(
        connection,
        owner,
        Gio.BusNameWatcherFlags.NONE,
        () => {
            setOwnerAlive(true);
            if (awaitingOwner) {
                awaitingOwner = false;
                app.activate();
                app.release();
            }
        },
        () => {
            setOwnerAlive(false);
            if (awaitingOwner) {
                awaitingOwner = false;
                app.release();
            }
            app.quit();
        }
    );
}

function main() {
    const allowTokenDefault = programArgs.includes('--allow-token');
    const xdphWindows = parseWindowList(GLib.getenv('XDPH_WINDOW_SHARING_LIST'));

    const app = new Gtk.Application({applicationId: APP_ID, flags: 0});
    const token: TokenState = {value: allowTokenDefault};
    const select = makeSelectFn(app, token);

    const sessionHandle = GLib.getenv('XDPH_SESSION_HANDLE');
    let ownerAlive = sessionHandle === null;
    let requesterWatch: number | null = null;
    let disposeCapture: (() => void) | null = null;
    if (sessionHandle !== null) {
        const owner = requesterNameFromSessionHandle(sessionHandle);
        if (owner === null) requesterWatch = null;
        else requesterWatch = watchPortalRequester(app, owner, (alive) => (ownerAlive = alive));
    }
    const guardedSelect: SelectFn = (kind, id) => {
        if (ownerAlive) select(kind, id);
        else app.quit();
    };

    app.connect('activate', () => {
        if (!ownerAlive) {
            if (sessionHandle !== null && requesterWatch === null) app.quit();
            return;
        }
        if (disposeCapture) {
            app.get_active_window()?.present();
            return;
        }
        disposeCapture = onActivate(app, token, guardedSelect, xdphWindows);
    });
    app.connect('shutdown', () => {
        disposeCapture?.();
        disposeCapture = null;
        if (requesterWatch !== null) {
            Gio.bus_unwatch_name(requesterWatch);
            requesterWatch = null;
        }
        ColorScheme.get_default().dispose();
        cleanTempDir();
    });
    app.run([]);
}

main();
