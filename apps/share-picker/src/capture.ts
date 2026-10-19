/**
 * grim-based screen/window capture, temp file handling, texture loading.
 */

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import type {MonitorState, PreviewHandle, WindowState} from './types';

const CAT = 'share-picker';

export const GRIM_BIN = GLib.find_program_in_path('grim') || 'grim';
/** User-private runtime dir (0700) — /tmp is world-writable and unsafe
 *  for screen capture previews. */
export const TEMP_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'dshell-picker']);
/** stagger per monitor — each monitor captured every N×monitorCount ms */
export const POLL_INTERVAL_MS = 200;

// ── Temp files ───────────────────────────────────────────────────

export function ensureTempDir(): void {
    try {
        GLib.mkdir_with_parents(TEMP_DIR, 0o700);
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

function runCapture(cmd: string[], onDone: (ok: boolean) => void): void {
    let completed = false;
    const complete = (ok: boolean): void => {
        if (completed) return;
        completed = true;
        onDone(ok);
    };
    let startFailed = false;
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.wait_check_async(null, (_proc, result) => {
            let ok = false;
            try {
                ok = proc.wait_check_finish(result);
            } catch (e) {
                logger.error(CAT, `runCapture: ${cmd.join(' ')}`, e);
            }
            complete(ok);
        });
    } catch (e) {
        if (completed) throw e;
        logger.error(CAT, `runCapture new: ${cmd.join(' ')}`, e);
        startFailed = true;
    }
    if (startFailed) complete(false);
}

function updatePreviews(
    state: MonitorState | WindowState,
    previews: readonly PreviewHandle[],
    texture: Gdk.Texture | null
): void {
    state.texture = texture;
    for (const preview of previews) {
        preview.setTexture(texture);
        preview.setState(texture ? 'available' : 'unavailable');
    }
}

function captureSource(
    state: MonitorState | WindowState,
    previews: readonly PreviewHandle[],
    path: string,
    cmd: string[]
): void {
    state.capturing = true;
    for (const preview of previews) preview.setState('loading');
    runCapture(cmd, (ok) => {
        state.capturing = false;
        let texture: Gdk.Texture | null = null;
        if (ok) {
            try {
                texture = Gdk.Texture.new_from_filename(path);
            } catch (e) {
                logger.error(CAT, `captureSource: Gdk.Texture.new_from_filename ${path}`, e);
            }
        }
        updatePreviews(state, previews, texture);
    });
}

export function captureMonitor(state: MonitorState, previews: readonly PreviewHandle[]): void {
    if (state.capturing) return;
    const path = monPath(state.info.name);
    logger.debug(CAT, `captureMonitor ${state.info.name} -> ${path}`);
    captureSource(state, previews, path, [GRIM_BIN, '-s', '0.25', '-o', state.info.name, path]);
}

export function captureWindow(state: WindowState, previews: readonly PreviewHandle[]): void {
    if (state.capturing) return;
    if (!state.geometry) {
        updatePreviews(state, previews, null);
        return;
    }
    const g = state.geometry;
    const addr = state.hyprAddress || state.info.address || state.info.id;
    const path = winPath(addr);
    const geometry = `${g.x},${g.y} ${g.width}x${g.height}`;
    logger.debug(CAT, `captureWindow addr=${addr} geometry=${geometry} -> ${path}`);
    captureSource(state, previews, path, [GRIM_BIN, '-s', '0.25', '-g', geometry, path]);
}
