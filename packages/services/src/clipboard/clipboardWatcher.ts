/**
 * wl-paste data-control watchers. Sensitive offers are discarded in the watch
 * child before reading clipboard bytes. Offer MIME hints are checked again
 * before delivery. Unexpected exits have a bounded restart, never a spin loop.
 */
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {type Process, subprocess} from '@shade/core/process';
import {Timeout} from '@shade/core/timeout';
import {imageMimeType, SENSITIVE_MIME_TYPES} from './clipboardPolicy';

export type ClipType = 'text' | 'image';
export type ClipboardChangeCallback = (
    type: ClipType,
    rawBytes: Uint8Array,
    mimeType: string
) => void;

const watchers: Record<ClipType, Process | null> = {text: null, image: null};
const retryTimers = {text: new Timeout(), image: new Timeout()};
const retryAttempts = {text: 0, image: 0};
const MAX_RESTARTS = 3;
let activeCallback: ClipboardChangeCallback | null = null;

const sensitivePatterns = SENSITIVE_MIME_TYPES.map((type) => `*"\n${type}\n"*`).join('|');
const WATCH_SCRIPT = `
case "\${CLIPBOARD_STATE-}" in sensitive|nil|clear) exit 0;; esac
types=$("$1" --list-types) || exit 0
case "
$types
" in ${sensitivePatterns}) exit 0;; esac
payload=$(base64 -w0) || exit 0
after=$("$1" --list-types) || exit 0
[ "$types" = "$after" ] || exit 0
printf '%s\\t%s\\t%s\\n' "$(printf '%s' "$types" | base64 -w0)" "$(printf '%s' "\${CLIPBOARD_TYPE-}" | base64 -w0)" "$payload"
`;

function restartWatcher(type: ClipType): void {
    if (!activeCallback) return;
    if (retryAttempts[type] >= MAX_RESTARTS) {
        logger.error('clipboard', `${type} watcher stopped after ${MAX_RESTARTS} retries`);
        return;
    }
    const delay = 250 * 4 ** retryAttempts[type]++;
    retryTimers[type].start(delay, () => {
        if (!activeCallback) return;
        try {
            spawnWatcher(type);
        } catch (error) {
            logger.warn('clipboard', `could not restart ${type} watcher:`, error);
            restartWatcher(type);
        }
    });
}

function spawnWatcher(type: ClipType): void {
    const wlPaste = GLib.find_program_in_path('wl-paste');
    if (!wlPaste) throw new Error('wl-paste is not installed');
    const startedAt = GLib.get_monotonic_time();
    const watcher = subprocess(
        [
            wlPaste,
            '--no-newline',
            '--type',
            type,
            '--watch',
            'sh',
            '-c',
            WATCH_SCRIPT,
            'clipboard-watch',
            wlPaste,
        ],
        (line: string) => {
            if (watchers[type] !== watcher) return;
            try {
                const [encodedTypes, encodedMime, encoded] = line.split('\t');
                if (!encodedTypes || encodedMime === undefined || !encoded) return;
                const decoder = new TextDecoder();
                const types = decoder.decode(GLib.base64_decode(encodedTypes)).split('\n');
                const offeredMime = decoder.decode(GLib.base64_decode(encodedMime));
                if (
                    types.some((mime) =>
                        SENSITIVE_MIME_TYPES.some((sensitive) => sensitive === mime)
                    )
                )
                    return;
                const raw = GLib.base64_decode(encoded);
                const imageTypes = types.filter((mime) => mime.startsWith('image/'));
                const mimeType = offeredMime.startsWith(`${type}/`)
                    ? offeredMime
                    : type === 'text'
                      ? 'text/plain'
                      : (imageMimeType(raw) ?? (imageTypes.length === 1 ? imageTypes[0] : null));
                if (!mimeType) {
                    logger.warn(
                        'clipboard',
                        'could not determine the copied image MIME type; skipping'
                    );
                    return;
                }
                activeCallback?.(type, raw, mimeType);
            } catch (error) {
                logger.error('clipboard', `failed to handle ${type} clipboard data:`, error);
            }
        },
        (error: string) => logger.warn('clipboard', `${type} watcher stderr:`, error.trim())
    );
    watchers[type] = watcher;
    watcher.connect('exit', (_, code: number, signaled: boolean) => {
        if (watchers[type] !== watcher) return;
        watchers[type] = null;
        if (!activeCallback) return;
        if (GLib.get_monotonic_time() - startedAt >= 30 * 1000 * 1000) retryAttempts[type] = 0;
        logger.warn(
            'clipboard',
            `${type} watcher exited (${signaled ? 'signal' : 'status'} ${code})`
        );
        restartWatcher(type);
    });
}

export function startClipboardWatcher(callback: ClipboardChangeCallback): void {
    if (activeCallback) return;
    activeCallback = callback;
    try {
        spawnWatcher('text');
        spawnWatcher('image');
    } catch (error) {
        stopClipboardWatcher();
        throw error;
    }
    logger.info('clipboard', 'wl-paste watchers started (text + image)');
}

export function stopClipboardWatcher(): void {
    activeCallback = null;
    for (const type of ['text', 'image'] as const) {
        retryTimers[type].cancel();
        retryAttempts[type] = 0;
        const watcher = watchers[type];
        watchers[type] = null;
        watcher?.kill();
    }
}

export function isWatching(): boolean {
    return watchers.text !== null && watchers.image !== null;
}
