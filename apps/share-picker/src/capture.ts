/**
 * grim-based screen/window capture, temp file handling, texture loading.
 */

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {createCaptureQueue} from './captureQueue';
import {resolvePreviewFrame} from './previewFrame';
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
    if (GLib.mkdir_with_parents(TEMP_DIR, 0o700) !== 0) {
        throw new Error('Could not create the private preview directory');
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
    const dir = Gio.File.new_for_path(TEMP_DIR);
    if (!dir.query_exists(null)) return;
    try {
        const enumerator = dir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        try {
            let info = enumerator.next_file(null);
            while (info) {
                dir.get_child(info.get_name()).delete(null);
                info = enumerator.next_file(null);
            }
        } finally {
            enumerator.close(null);
        }
        dir.delete(null);
    } catch (error) {
        logger.warn(CAT, 'could not remove private preview files', error);
    }
}

// ── Capture helpers ──────────────────────────────────────────────

/**
 * Capture fan-out stays bounded when the combined view refreshes several
 * monitors at once, so grim children do not overwhelm the picker's main loop.
 */
const schedule = createCaptureQueue(3);

function runQueued(cmd: string[], onDone: (ok: boolean) => void): void {
    schedule((done) =>
        runCapture(cmd, (ok) => {
            done();
            onDone(ok);
        })
    );
}

function runCapture(cmd: string[], onDone: (ok: boolean) => void): void {
    if (stopped) {
        onDone(false);
        return;
    }
    let proc: Gio.Subprocess;
    try {
        proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
        );
    } catch (e) {
        logger.error(CAT, `runCapture new: ${cmd.join(' ')}`, e);
        onDone(false);
        return;
    }
    if (startFailed) complete(false);
}

function updatePreviews(
    state: MonitorState | WindowState,
    previews: readonly PreviewHandle[],
    texture: Gdk.Texture | null
): void {
    const previousTexture = state.texture;
    const frame = resolvePreviewFrame(previousTexture, texture);
    state.texture = frame.texture;
    for (const preview of previews) {
        if (frame.texture !== previousTexture) preview.setTexture(frame.texture);
        preview.setState(frame.state);
    }
}

function captureSource(
    state: MonitorState | WindowState,
    previews: readonly PreviewHandle[],
    path: string,
    cmd: string[]
): void {
    state.capturing = true;
    // Keep the last good frame visible while grim writes the next one. The
    // loading placeholder is only useful before the first successful frame.
    if (!state.texture) {
        for (const preview of previews) preview.setState('loading');
    }
    runQueued(cmd, (ok) => {
        state.capturing = false;
        if (stopped) return;
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
    if (stopped || state.capturing) return;
    const path = monPath(state.info.name);
    logger.debug(CAT, `captureMonitor ${state.info.name} -> ${path}`);
    captureSource(state, previews, path, [
        GRIM_BIN,
        '-l',
        '0',
        '-s',
        '0.25',
        '-o',
        state.info.name,
        path,
    ]);
}

export function captureWindow(state: WindowState, previews: readonly PreviewHandle[]): void {
    if (state.capturing) return;
        updatePreviews(state, previews, null);
        return;
    }
}
