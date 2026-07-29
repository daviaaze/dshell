/**
 * grim-based screen/window capture, temp file handling, texture loading.
 */
import GLib from 'gi://GLib?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '../../lib/core/logger';
import type {MonitorState, WindowState} from './types';

const CAT = 'share-picker';

export const GRIM_BIN = GLib.find_program_in_path('grim') || 'grim';
export const TEMP_DIR = '/tmp/dshell-picker';
/** stagger per monitor — each monitor captured every N×monitorCount ms */
export const POLL_INTERVAL_MS = 200;

// ── Temp files ───────────────────────────────────────────────────

export function ensureTempDir(): void {
    try {
        GLib.mkdir_with_parents(TEMP_DIR, 0o755);
    } catch {
        /* ignore */
    }
}

export function monPath(name: string): string {
    return `${TEMP_DIR}/mon-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
}

export function winPath(addr: string): string {
    const safe = addr.replace(/^0x/, '').replace(/[^a-fA-F0-9]/g, '');
    return `${TEMP_DIR}/win-${safe}.png`;
}

export function cleanTempDir(): void {
    try {
        const dir = Gio.File.new_for_path(TEMP_DIR);
        const enumerator = dir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info = enumerator.next_file(null);
        while (info) {
            const child = dir.get_child(info.get_name());
            child.delete(null);
            info = enumerator.next_file(null);
        }
    } catch {
        // ignore cleanup failures
    }
}

// ── Capture helpers ──────────────────────────────────────────────

/** Synchronous version — blocks until grim finishes. Use for initial captures. */
export function runCaptureSync(cmd: string[]): boolean {
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [, , err] = proc.communicate_utf8(null, null);
        if (!proc.get_successful()) {
            logger.error(
                CAT,
                `runCaptureSync: ${cmd.join(' ')}`,
                err?.trim() || '(no stderr)'
            );
            return false;
        }
        return true;
    } catch (e) {
        logger.error(CAT, `runCaptureSync new: ${cmd.join(' ')}`, e);
        return false;
    }
}

export function runCapture(cmd: string[], onDone: (ok: boolean) => void): void {
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.wait_check_async(null, (_proc, result) => {
            try {
                proc.wait_check_finish(result);
                onDone(true);
            } catch (e) {
                logger.error(CAT, `runCapture: ${cmd.join(' ')}`, e);
                onDone(false);
            }
        });
    } catch (e) {
        logger.error(CAT, `runCapture new: ${cmd.join(' ')}`, e);
        onDone(false);
    }
}

// ── Texture loading ──────────────────────────────────────────────

export function loadTexture(path: string, picture: Gtk.Picture): void {
    const exists = GLib.file_test(path, GLib.FileTest.EXISTS);
    logger.debug(CAT, `loadTexture ${path} exists=${exists}`);
    if (exists) {
        try {
            const tex = Gdk.Texture.new_from_filename(path);
            picture.set_paintable(tex);
        } catch (e) {
            logger.error(CAT, `loadTexture: ${path}`, e);
        }
    }
}

function loadTextureAll(path: string, pictures: Gtk.Picture[]): void {
    if (pictures.length === 0) return;
    const exists = GLib.file_test(path, GLib.FileTest.EXISTS);
    logger.debug(
        CAT,
        `loadTextureAll ${path} exists=${exists} count=${pictures.length}`
    );
    if (exists) {
        try {
            const tex = Gdk.Texture.new_from_filename(path);
            for (const pic of pictures) {
                pic.set_paintable(tex);
            }
        } catch (e) {
            logger.error(CAT, `loadTextureAll: ${path}`, e);
        }
    }
}

// ── Capture functions ────────────────────────────────────────────

/** Synchronous monitor capture — blocks until done. For initial renders. */
export function captureMonitorSync(
    state: MonitorState,
    pictures: Gtk.Picture[]
): boolean {
    const path = monPath(state.info.name);
    logger.debug(CAT, `captureMonitorSync ${state.info.name} -> ${path}`);
    const ok = runCaptureSync([
        GRIM_BIN,
        '-s',
        '0.25',
        '-o',
        state.info.name,
        path,
    ]);
    logger.debug(CAT, `captureMonitorSync ${state.info.name} ok=${ok}`);
    if (ok) {
        try {
            state.texture = Gdk.Texture.new_from_filename(path);
        } catch (e) {
            logger.error(
                CAT,
                `captureMonitorSync: Gdk.Texture.new_from_filename ${path}`,
                e
            );
        }
        for (const pic of pictures) {
            try {
                pic.set_paintable(Gdk.Texture.new_from_filename(path));
            } catch (e) {
                logger.error(
                    CAT,
                    `captureMonitorSync: pic.set_paintable ${path}`,
                    e
                );
            }
        }
    }
    return ok;
}

/** Synchronous window capture — blocks until done. For initial renders. */
export function captureWindowSync(
    state: WindowState,
    pictures: Gtk.Picture[]
): boolean {
    if (!state.geometry) return false;
    const g = state.geometry;
    const addr = windowAddr(state);
    const path = winPath(addr);
    const geometry = `${g.x},${g.y} ${g.width}x${g.height}`;
    logger.debug(
        CAT,
        `captureWindowSync addr=${addr} geometry=${geometry} -> ${path}`
    );
    const ok = runCaptureSync([GRIM_BIN, '-s', '0.25', '-g', geometry, path]);
    logger.debug(CAT, `captureWindowSync ${addr} ok=${ok}`);
    if (ok) {
        try {
            state.texture = Gdk.Texture.new_from_filename(path);
        } catch (e) {
            logger.error(
                CAT,
                `captureWindowSync: Gdk.Texture.new_from_filename ${path}`,
                e
            );
        }
        for (const pic of pictures) {
            try {
                pic.set_paintable(Gdk.Texture.new_from_filename(path));
            } catch (e) {
                logger.error(
                    CAT,
                    `captureWindowSync: pic.set_paintable ${path}`,
                    e
                );
            }
        }
    }
    return ok;
}

export function captureMonitor(
    state: MonitorState,
    pictures: Gtk.Picture[]
): void {
    if (state.capturing) return;
    state.capturing = true;
    const path = monPath(state.info.name);
    logger.debug(CAT, `captureMonitor ${state.info.name} -> ${path}`);
    runCapture([GRIM_BIN, '-s', '0.25', '-o', state.info.name, path], ok => {
        state.capturing = false;
        logger.debug(CAT, `captureMonitor ${state.info.name} ok=${ok}`);
        if (ok) {
            try {
                state.texture = Gdk.Texture.new_from_filename(path);
            } catch (e) {
                logger.error(
                    CAT,
                    `captureMonitor: Gdk.Texture.new_from_filename ${path}`,
                    e
                );
            }
            loadTextureAll(path, pictures);
        }
    });
}

/** Address used for the temp file name of a window capture */
export function windowAddr(state: WindowState): string {
    return state.hyprAddress || state.info.address || state.info.id;
}

export function captureWindow(
    state: WindowState,
    pictures: Gtk.Picture[]
): void {
    if (!state.geometry || state.capturing) return;
    state.capturing = true;
    const g = state.geometry;
    const addr = windowAddr(state);
    const path = winPath(addr);
    const geometry = `${g.x},${g.y} ${g.width}x${g.height}`;
    logger.debug(
        CAT,
        `captureWindow addr=${addr} geometry=${geometry} -> ${path}`
    );
    runCapture([GRIM_BIN, '-s', '0.25', '-g', geometry, path], ok => {
        state.capturing = false;
        logger.debug(CAT, `captureWindow ${addr} ok=${ok}`);
        if (ok) {
            try {
                state.texture = Gdk.Texture.new_from_filename(path);
            } catch (e) {
                logger.error(
                    CAT,
                    `captureWindow: Gdk.Texture.new_from_filename ${path}`,
                    e
                );
            }
            loadTextureAll(path, pictures);
        }
    });
}
