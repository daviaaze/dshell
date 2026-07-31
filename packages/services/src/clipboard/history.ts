/**
 * Clipboard History — Entry-point for clipboard history service.
 *
 * Starts the wl-paste --watch watcher (replaces the old Gdk.Clipboard
 * 'changed' signal which was focus-gated on Wayland).
 *
 * Gdk.Clipboard is kept only for _setting_ content when the user copies
 * an entry back from history. An echo-hash prevents those sets from
 * being re-captured by the watcher.
 *
 * Images are stored as base64 inside the encrypted blob (not as separate
 * PNG files). Migration from the legacy file-based format happens
 * automatically in EncryptedStore.init().
 *
 * @module clipboardHistory
 */

import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {
    initStore,
    getAllEntries,
    searchEntries,
    addEntry as storeAddEntry,
    deleteEntry as storeDeleteEntry,
    togglePin as storeTogglePin,
    clearHistory as storeClearHistory,
    type ClipboardEntry,
} from './encryptedStore';
export type {ClipboardEntry};
import {startClipboardWatcher, stopClipboardWatcher} from './clipboardWatcher';
import logger from '@shade/core/logger';

// ── State ────────────────────────────────────────────────────────────────────

let initialized = false;
let echoHash: string | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Compute a quick content hash for echo suppression.
 * Hashes the base64 of the data to avoid null-byte truncation.
 */
function contentHash(data: Uint8Array): string {
    const b64 = GLib.base64_encode(data);
    // GLib.ChecksumType.SHA1 is a numeric enum
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, b64, -1) ?? '';
}

// Deterministic uniqueness — timestamp + monotonic counter, no PRNG needed
// (IDs are collision-avoidance only, not security tokens).
let idCounter = 0;

function generateId(): string {
    return (
        Date.now().toString(36) + (idCounter++).toString(36).padStart(4, '0')
    );
}

// ── Watcher callback ─────────────────────────────────────────────────────────

function onClipboardData(type: 'text' | 'image', rawBytes: Uint8Array) {
    // Echo-hash: skip if this content matches what we last set via copyEntryToClipboard
    const hash = contentHash(rawBytes);
    if (echoHash !== null && hash === echoHash) {
        echoHash = null;
        logger.debug('clipboard', 'echo-hash hit — suppressing self-capture');
        return;
    }

    if (type === 'text') {
        const text = decoder.decode(rawBytes);
        if (text.trim().length === 0) {
            logger.debug('clipboard', 'empty text, skipping');
            return;
        }
        storeAddEntry({
            id: generateId(),
            type: 'text',
            content: text,
            mimeType: 'text/plain',
            timestamp: Date.now(),
            pinned: false,
        });
    } else {
        // Image — store as base64 string inside the encrypted blob
        const base64 = GLib.base64_encode(rawBytes);
        storeAddEntry({
            id: generateId(),
            type: 'image',
            content: base64,
            mimeType: 'image/png',
            timestamp: Date.now(),
            pinned: false,
        });
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start monitoring the clipboard for changes.
 * Call once during app initialisation.
 */
export function initClipboardHistory() {
    if (initialized) return;
    initialized = true;

    // Initialise the encrypted store
    initStore();

    // Start the wl-paste watchers (replaces Gdk.Clipboard 'changed')
    startClipboardWatcher(onClipboardData);

    logger.info('clipboard', 'clipboard history monitoring started');
}

/**
 * Stop monitoring the clipboard.
 */
export function stopClipboardHistory() {
    stopClipboardWatcher();
    initialized = false;
    logger.info('clipboard', 'clipboard history monitoring stopped');
}

/**
 * Get all history entries, most recent first.
 */
export function getHistory(): ClipboardEntry[] {
    return getAllEntries();
}

/**
 * Search history entries by text content.
 */
export function searchHistory(query: string): ClipboardEntry[] {
    return searchEntries(query);
}

/**
 * Copy a history entry back to the system clipboard.
 *
 * Uses Gdk.Clipboard.set (or set_content for images).
 * Sets the echo-hash so the next watcher event for this content is
 * suppressed.
 */
export async function copyEntryToClipboard(
    entry: ClipboardEntry
): Promise<void> {
    const display = Gdk.Display.get_default();
    if (!display) {
        logger.warn('clipboard', 'no display available');
        return;
    }

    const clipboard = display.get_clipboard();

    try {
        if (entry.type === 'text') {
            const bytes = encoder.encode(entry.content);
            echoHash = contentHash(bytes);
            clipboard.set(entry.content);
        } else {
            // Image — decode from base64 and create a content provider
            const raw = new Uint8Array(GLib.base64_decode(entry.content));
            echoHash = contentHash(raw);
            const provider = Gdk.ContentProvider.new_for_bytes(
                entry.mimeType,
                raw
            );
            clipboard.set_content(provider);
        }
    } catch (e) {
        logger.error('clipboard', 'failed to copy entry to clipboard:', e);
        echoHash = null;
    }
}

/**
 * Delete a history entry by ID.
 */
export function deleteEntry(id: string): void {
    storeDeleteEntry(id);
}

/**
 * Toggle the pinned state of a history entry.
 */
export function togglePin(id: string): void {
    storeTogglePin(id);
}

/**
 * Clear all unpinned history entries.
 */
export function clearHistory(): void {
    storeClearHistory();
}
