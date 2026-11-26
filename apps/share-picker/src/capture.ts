/**
 * grim monitor previews and a single bounded batch of native window thumbnails.
 */

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {createCaptureQueue} from './captureQueue';
import {resolvePreviewFrame} from './previewFrame';
import type {MonitorState, PreviewHandle, WindowState} from './types';
import {planWindowCaptureBatch} from './windowCaptureBatch';

const CAT = 'share-picker';

export const GRIM_BIN = GLib.find_program_in_path('grim') || 'grim';
export const WINDOW_THUMBNAIL_BIN =
    GLib.find_program_in_path('shade-window-thumbnail') || 'shade-window-thumbnail';
/** Fresh user-private directory, including across PID reuse after an unclean exit. */
export const TEMP_DIR = GLib.build_filenamev([
    GLib.get_user_runtime_dir(),
    `dshell-picker-${new Gio.Credentials().get_unix_pid()}-${GLib.uuid_string_random()}`,
]);
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

/** grim normally ends well under a second; a hung one must not hold a queue slot forever. */
const CAPTURE_TIMEOUT_MS = 10000;
/** The native helper has its own 3.5s deadline; also bound a stalled/crashed backend. */
const WINDOW_CAPTURE_TIMEOUT_MS = 5000;

/** Live capture children, so shutdown can stop them before the temp dir is wiped. */
const running = new Map<Gio.Subprocess, number>();
let stopped = false;
let windowBatchStarted = false;

/**
 * Kill every in-flight capture and wait for it to be reaped. Call before
 * cleanTempDir(): an unreaped child could write its PNG after the wipe.
 */
export function stopCaptures(): void {
    stopped = true;
    for (const [proc, watchdog] of running) {
        if (watchdog) GLib.source_remove(watchdog);
        proc.force_exit();
        try {
            proc.wait(null);
        } catch (e) {
            logger.warn(CAT, 'stopCaptures: waiting for capture failed', e);
        }
    }
    running.clear();
}

function runCapture(
    cmd: string[],
    onDone: (ok: boolean) => void,
    timeoutMs = CAPTURE_TIMEOUT_MS
): void {
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
    const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        running.set(proc, 0);
        logger.warn(CAT, `runCapture timed out: ${cmd.join(' ')}`);
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    running.set(proc, watchdog);
    proc.wait_check_async(null, (_proc, result) => {
        const timer = running.get(proc);
        if (timer) GLib.source_remove(timer);
        running.delete(proc);
        let ok = false;
        try {
            ok = proc.wait_check_finish(result);
        } catch (e) {
            if (!stopped) logger.error(CAT, `runCapture: ${cmd.join(' ')}`, e);
        }
        onDone(ok);
    });
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
    state: MonitorState,
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

/**
 * Capture only the picker-listed, exactly identified windows, once per picker.
 * One native child handles at most 128 unique IDs; tabs and the selection
 * summary share each returned texture. Missing files are unavailable previews,
 * never a reason to substitute a composited monitor crop.
 */
export function captureWindows(
    windows: readonly WindowState[],
    targets: readonly (readonly PreviewHandle[])[],
    executable = WINDOW_THUMBNAIL_BIN
): void {
    if (stopped || windowBatchStarted) return;
    windowBatchStarted = true;
    const requests = planWindowCaptureBatch(windows, TEMP_DIR);
    const requestedIds = new Set(requests.map((request) => request.stableId));
    windows.forEach((state, index) => {
        state.capturing = state.hyprStableId !== null && requestedIds.has(state.hyprStableId);
        for (const preview of targets[index] ?? []) {
            preview.setState(state.capturing ? 'loading' : 'unavailable');
        }
    });
    if (requests.length === 0) return;
    const cmd = [executable];
    for (const request of requests) cmd.push(request.stableId, request.path);
    runCapture(
        cmd,
        () => {
            for (const request of requests) {
                let texture: Gdk.Texture | null = null;
                // The helper can complete only part of a batch, even on a
                // nonzero exit. A fresh, valid PNG is the per-window result.
                if (!stopped && GLib.file_test(request.path, GLib.FileTest.IS_REGULAR)) {
                    try {
                        texture = Gdk.Texture.new_from_filename(request.path);
                    } catch (error) {
                        logger.warn(CAT, 'could not load native window thumbnail', error);
                    }
                }
                for (const index of request.indices) {
                    const state = windows[index];
                    state.capturing = false;
                    if (!stopped) updatePreviews(state, targets[index] ?? [], texture);
                }
            }
        },
        WINDOW_CAPTURE_TIMEOUT_MS
    );
}
