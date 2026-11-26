/**
 * Clipboard capture and picker API. Password-manager hints are filtered by
 * ClipboardWatcher, images retain their actual MIME type, and self-copy
 * suppression expires rather than hiding a later genuine copy indefinitely.
 */
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import {Timeout} from '@shade/core/timeout';
import logger from '@shade/core/logger';
import {
    type ClipboardEntry,
    EncryptedStore,
    getAllEntries,
    searchEntries,
    addEntry as storeAddEntry,
    clearHistory as storeClearHistory,
    deleteEntry as storeDeleteEntry,
    shutdownStore,
    togglePin as storeTogglePin,
} from './encryptedStore';
import {startClipboardWatcher, stopClipboardWatcher} from './clipboardWatcher';

export type {ClipboardEntry};

let initialized = false;
let monitoringRequested = false;
let startupAttempts = 0;
let initSource = 0;
let echoHash: string | null = null;
let idCounter = 0;
const echoTimer = new Timeout();
const startupRetryTimer = new Timeout();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function contentHash(data: Uint8Array): string {
    return (
        GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, GLib.base64_encode(data), -1) ?? ''
    );
}

function onClipboardData(type: 'text' | 'image', rawBytes: Uint8Array, mimeType: string): void {
    if (echoHash !== null) {
        const isEcho = contentHash(rawBytes) === echoHash;
        echoHash = null;
        echoTimer.cancel();
        if (isEcho) return;
    }
    const content = type === 'text' ? decoder.decode(rawBytes) : GLib.base64_encode(rawBytes);
    if (type === 'text' && content.trim().length === 0) return;
    storeAddEntry({
        id: Date.now().toString(36) + (idCounter++).toString(36).padStart(4, '0'),
        type,
        content,
        mimeType,
        timestamp: Date.now(),
        pinned: false,
    });
}

export function initClipboardHistory(): void {
    monitoringRequested = true;
    if (initialized) return;
    // Initialization must still happen when the capture executable is absent.
    if (!initSource && !EncryptedStore.get_default().ready) {
        initSource = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            initSource = 0;
            if (monitoringRequested) {
                void EncryptedStore.get_default()
                    .initAsync()
                    .catch((error) =>
                        logger.error('clipboard', 'failed to initialize history:', error)
                    );
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    try {
        startClipboardWatcher(onClipboardData);
        initialized = true;
        startupAttempts = 0;
        startupRetryTimer.cancel();
    } catch (error) {
        logger.warn('clipboard', 'could not start clipboard monitoring:', error);
        if (startupAttempts < 3) {
            startupRetryTimer.start(250 * 4 ** startupAttempts++, () => {
                if (monitoringRequested) initClipboardHistory();
            });
        }
    }
}

export function stopClipboardHistory(): void {
    monitoringRequested = false;
    startupRetryTimer.cancel();
    startupAttempts = 0;
    if (initSource) GLib.source_remove(initSource);
    initSource = 0;
    stopClipboardWatcher();
    initialized = false;
    echoHash = null;
    echoTimer.cancel();
}

export function getHistory(): ClipboardEntry[] {
    return getAllEntries();
}

export function searchHistory(query: string): ClipboardEntry[] {
    return searchEntries(query);
}

export async function copyEntryToClipboard(entry: ClipboardEntry): Promise<void> {
    const display = Gdk.Display.get_default();
    if (!display) {
        logger.warn('clipboard', 'no display available');
        return;
    }
    const raw =
        entry.type === 'text' ? encoder.encode(entry.content) : GLib.base64_decode(entry.content);
    echoHash = contentHash(raw);
    echoTimer.start(2000, () => {
        echoHash = null;
    });
    try {
        const clipboard = display.get_clipboard();
        if (entry.type === 'text') {
            clipboard.set(entry.content);
        } else {
            const provider = Gdk.ContentProvider.new_for_bytes(entry.mimeType, new GLib.Bytes(raw));
            if (!clipboard.set_content(provider))
                throw new Error('clipboard rejected the image content provider');
        }
    } catch (error) {
        echoHash = null;
        echoTimer.cancel();
        logger.error('clipboard', 'failed to copy entry to clipboard:', error);
    }
}

export function deleteEntry(id: string): void {
    storeDeleteEntry(id);
}

export function togglePin(id: string): void {
    storeTogglePin(id);
}

export function clearHistory(): void {
    storeClearHistory();
}

defineService({
    name: 'ClipboardHistory',
    service: {
        init: () => initClipboardHistory(),
        dispose: () => {
            stopClipboardHistory();
            return shutdownStore();
        },
    },
});
