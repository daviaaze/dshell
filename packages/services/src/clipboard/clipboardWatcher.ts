/**
 * ClipboardWatcher — Spawns two wl-paste --watch subprocesses to capture
 * clipboard changes via the ext-data-control / wlr-data-control protocol.
 *
 * This replaces Gdk.Clipboard 'changed' signal, which on Wayland only fires
 * while the client has keyboard focus (wl_data_device protocol limitation).
 *
 * Watchers:
 *   - text:  wl-paste --no-newline --type text --watch sh -c 'base64 -w0; echo'
 *   - image: wl-paste --type image --watch sh -c 'base64 -w0; echo'
 *
 * Each clipboard change is delivered as a single base64-encoded line via
 * GDataInputStream.read_line_async (handled by the Process class).
 */

import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {type Process, subprocess} from '@shade/core/process';

export type ClipType = 'text' | 'image';

export type ClipboardChangeCallback = (type: ClipType, rawBytes: Uint8Array) => void;

let textWatcher: Process | null = null;
let imageWatcher: Process | null = null;
let activeCallback: ClipboardChangeCallback | null = null;

/**
 * Start wl-paste --watch watchers for both text and image content.
 * Calls `callback` each time the clipboard changes.
 *
 * The callback receives the raw bytes (base64-decoded). Text callers
 * should TextDecoder to string; image callers should store as base64
 * or handle binary directly.
 */
export function startClipboardWatcher(callback: ClipboardChangeCallback): void {
    if (textWatcher || imageWatcher) {
        logger.warn('clipboard', 'watcher already started, ignoring duplicate start');
        return;
    }

    activeCallback = callback;

    // Text watcher: base64-encode clipboard text, output one line per change
    textWatcher = subprocess(
        ['wl-paste', '--no-newline', '--type', 'text', '--watch', 'sh', '-c', 'base64 -w0; echo'],
        (line: string) => {
            try {
                const trimmed = line.trim();
                if (!trimmed) return;
                const raw = GLib.base64_decode(trimmed);
                activeCallback?.('text', raw);
            } catch (e) {
                logger.error('clipboard', 'failed to decode text:', e);
            }
        },
        (err: string) => {
            logger.warn('clipboard', 'text watcher stderr:', err.trim());
        }
    );

    // Image watcher: base64-encode PNG data, output one line per change
    imageWatcher = subprocess(
        ['wl-paste', '--type', 'image', '--watch', 'sh', '-c', 'base64 -w0; echo'],
        (line: string) => {
            try {
                const trimmed = line.trim();
                if (!trimmed) return;
                const raw = GLib.base64_decode(trimmed);
                activeCallback?.('image', raw);
            } catch (e) {
                logger.error('clipboard', 'failed to decode image:', e);
            }
        },
        (err: string) => {
            logger.warn('clipboard', 'image watcher stderr:', err.trim());
        }
    );

    logger.info('clipboard', 'wl-paste watchers started (text + image)');
}

/**
 * Stop the clipboard watchers and clean up.
 */
export function stopClipboardWatcher(): void {
    [textWatcher, imageWatcher].forEach((w) => w?.kill());
    textWatcher = null;
    imageWatcher = null;
    activeCallback = null;
    logger.info('clipboard', 'wl-paste watchers stopped');
}

/**
 * Check whether the watchers are currently running.
 */
export function isWatching(): boolean {
    return textWatcher !== null && imageWatcher !== null;
}
