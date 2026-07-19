/**
 * Clipboard History — Encrypted SQLite-backed clipboard history.
 *
 * Public API remains unchanged. Internal storage replaced with
 * EncryptedStore (AES-256-GCM encrypted SQLite database via Gda).
 *
 * @module clipboardHistory
 */

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {
    initStore,
    getAllEntries,
    searchEntries,
    addEntry as storeAddEntry,
    deleteEntry as storeDeleteEntry,
    togglePin as storeTogglePin,
    clearHistory as storeClearHistory,
    getEntry,
    type ClipboardEntry,
} from './encryptedStore';
export type { ClipboardEntry };
import logger from '#/lib/core/logger';

// ── Constants ────────────────────────────────────────────────────────────────

const DATA_DIR = `${GLib.get_user_data_dir()}/shade-shell`;
const CLIPBOARD_DIR = `${DATA_DIR}/clipboard`;

// Artificially shorten the debounce in tests — O(1) check, negligible overhead
const DEBOUNCE_MS = GLib.getenv('G_TEST_OPTIONS') ? 10 : 300;

// ── State ────────────────────────────────────────────────────────────────────

let debounceId: number | null = null;
let skipNextChange = false;
let initialized = false;

// ── File helpers ─────────────────────────────────────────────────────────────

function generateId(): string {
    // eslint-disable-next-line sonarjs/pseudo-random
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Clipboard monitoring ─────────────────────────────────────────────────────

function onClipboardChanged(clipboard: Gdk.Clipboard) {
    // If we just set the clipboard from history, skip storing it
    if (skipNextChange) {
        skipNextChange = false;
        return;
    }

    // Debounce: multiple rapid changes (e.g., selecting text while copying)
    // should only trigger one history entry.
    if (debounceId !== null) {
        GLib.source_remove(debounceId);
    }
    debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
        debounceId = null;
        readClipboardContent(clipboard);
        return GLib.SOURCE_REMOVE;
    });
}

function readClipboardContent(clipboard: Gdk.Clipboard) {
    // GJS 1.88 requires callback-based API for Gdk.Clipboard async methods
    clipboard.read_text_async(null, (_source, result) => {
        try {
            const text = clipboard.read_text_finish(result);
            if (text !== null && text.trim().length > 0) {
                addEntry({
                    type: 'text',
                    content: text,
                    mimeType: 'text/plain',
                });
                return;
            }

            // Try image
            try {
                clipboard.read_texture_async(null, (_source2, result2) => {
                    try {
                        const texture = clipboard.read_texture_finish(result2);
                        if (texture !== null) {
                            const bytes = texture.save_to_png_bytes();
                            const filename = `clipboard-${Date.now()}.png`;
                            const filePath = `${CLIPBOARD_DIR}/${filename}`;
                            GLib.file_set_contents(filePath, bytes.toArray());
                            addEntry({
                                type: 'image',
                                content: filename,
                                mimeType: 'image/png',
                            });
                        }
                    } catch {
                        // Not an image — skip
                    }
                });
            } catch {
                // Not an image — skip
            }
        } catch (e) {
            // read_text_finish throws when clipboard has no text (image, etc.)
            // This is expected — we fall through to try reading as image below.
            // Only log at debug since the fallback is handled.
            logger.debug('clipboard', 'no text on clipboard, trying image:', e);
        }
    });
}

function addEntry(data: {type: 'text' | 'image'; content: string; mimeType: string}) {
    // Deduplicate: skip if the last entry is identical (same text content)
    const entries = getAllEntries();
    if (data.type === 'text' && entries.length > 0) {
        const last = entries[0]!;
        if (last.type === 'text' && last.content === data.content) {
            return;
        }
    }

    const entry: ClipboardEntry = {
        id: generateId(),
        type: data.type,
        content: data.content,
        mimeType: data.mimeType,
        timestamp: Date.now(),
        pinned: false,
    };

    storeAddEntry(entry);
}

function deleteImageFile(filename: string) {
    try {
        const file = Gio.File.new_for_path(`${CLIPBOARD_DIR}/${filename}`);
        if (file.query_exists(null)) {
            file.delete(null);
        }
    } catch (e) {
        logger.warn('clipboard', 'failed to delete image file:', e);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start monitoring the clipboard for changes.
 * Call once during app initialization.
 */
export function initClipboardHistory() {
    if (initialized) return;
    initialized = true;

    // Initialize the encrypted store (decrypt file, open SQLite)
    initStore();

    const display = Gdk.Display.get_default();
    if (!display) {
        logger.warn('clipboard', 'no display available, clipboard history disabled');
        return;
    }

    const clipboard = display.get_clipboard();
    clipboard.connect('changed', () => onClipboardChanged(clipboard));

    // Also try to read the current clipboard content on startup
    // (in case something was copied before the app started)
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        readClipboardContent(clipboard);
        return GLib.SOURCE_REMOVE;
    });

    logger.info('clipboard', 'clipboard history monitoring started');
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
 * Copy a history entry back to the clipboard.
 */
export async function copyEntryToClipboard(entry: ClipboardEntry): Promise<void> {
    const display = Gdk.Display.get_default();
    if (!display) {
        logger.warn('clipboard', 'no display available');
        return;
    }

    const clipboard = display.get_clipboard();
    skipNextChange = true;

    try {
        if (entry.type === 'text') {
            clipboard.set(entry.content);
        } else if (entry.type === 'image') {
            const filePath = `${CLIPBOARD_DIR}/${entry.content}`;
            const file = Gio.File.new_for_path(filePath);
            if (!file.query_exists(null)) {
                logger.warn('clipboard', 'image file not found:', filePath);
                return;
            }
            const [, contents] = file.load_contents(null);
            if (contents) {
                const provider = Gdk.ContentProvider.new_for_bytes(
                    entry.mimeType,
                    contents
                );
                clipboard.set_content(provider);
            }
        }
    } catch (e) {
        logger.error('clipboard', 'failed to copy entry to clipboard:', e);
        skipNextChange = false;
    }
}

/**
 * Delete a history entry by ID.
 */
export function deleteEntry(id: string): void {
    // Delete image file if it's an image entry
    const entry = getEntry(id);
    if (entry && entry.type === 'image') {
        deleteImageFile(entry.content);
    }
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
    // Delete image files for unpinned entries
    const entries = getAllEntries();
    for (const entry of entries) {
        if (!entry.pinned && entry.type === 'image') {
            deleteImageFile(entry.content);
        }
    }
    storeClearHistory();
}