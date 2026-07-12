import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '#/lib/logger';

export interface ClipboardEntry {
    id: string;
    type: 'text' | 'image';
    /** For text: the full text content. For images: filename in the clipboard dir. */
    content: string;
    mimeType: string;
    timestamp: number;
    pinned: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
const DATA_DIR = `${GLib.get_user_data_dir()}/shade-shell`;
const HISTORY_FILE = `${DATA_DIR}/clipboard-history.json`;
const CLIPBOARD_DIR = `${DATA_DIR}/clipboard`;

// Artificially shorten the debounce in tests — O(1) check, negligible overhead
const DEBOUNCE_MS = GLib.getenv('G_TEST_OPTIONS') ? 10 : 300;

// ── State ────────────────────────────────────────────────────────────────────

let history: ClipboardEntry[] = [];
let debounceId: number | null = null;
let skipNextChange = false;
let initialized = false;

// ── File helpers ─────────────────────────────────────────────────────────────

function ensureDirs() {
    GLib.mkdir_with_parents(CLIPBOARD_DIR, 0o755);
}

function loadHistory(): void {
    const file = Gio.File.new_for_path(HISTORY_FILE);
    if (!file.query_exists(null)) {
        history = [];
        return;
    }
    try {
        const [, contents] = file.load_contents(null);
        if (contents) {
            const decoder = new TextDecoder();
            const parsed = JSON.parse(decoder.decode(contents));
            history = (parsed.entries || []) as ClipboardEntry[];
        }
    } catch (e) {
        logger.error('clipboard', 'failed to load history:', e);
        history = [];
    }
}

function saveHistory(): void {
    try {
        ensureDirs();
        const data = JSON.stringify({entries: history}, null, 2);
        GLib.file_set_contents(HISTORY_FILE, data);
    } catch (e) {
        logger.error('clipboard', 'failed to save history:', e);
    }
}

function generateId(): string {
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

async function readClipboardContent(clipboard: Gdk.Clipboard) {
    try {
        // Try text first — most common case
        const text = await clipboard.read_text_async(null);
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
            const texture = await clipboard.read_texture_async(null);
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
    } catch (e) {
        logger.warn('clipboard', 'failed to read clipboard content:', e);
    }
}

function addEntry(data: {type: 'text' | 'image'; content: string; mimeType: string}) {
    // Deduplicate: skip if the last entry is identical (same text content)
    if (data.type === 'text' && history.length > 0) {
        const last = history[0]!;
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

    // Insert at the front (most recent first)
    history.unshift(entry);

    // Evict oldest unpinned entries beyond the limit
    if (history.length > MAX_HISTORY) {
        // Count pinned entries
        let pinnedCount = 0;
        let evictable = 0;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]!.pinned) {
                pinnedCount++;
            } else {
                evictable++;
            }
        }
        const targetEvict = history.length - MAX_HISTORY;
        if (targetEvict > 0) {
            // Remove oldest unpinned entries
            let evicted = 0;
            for (let i = history.length - 1; i >= 0 && evicted < targetEvict; i--) {
                if (!history[i]!.pinned) {
                    // Delete image file if it's an image entry
                    if (history[i]!.type === 'image') {
                        deleteImageFile(history[i]!.content);
                    }
                    history.splice(i, 1);
                    evicted++;
                }
            }
        }
    }

    saveHistory();
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

    loadHistory();

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
    return [...history];
}

/**
 * Search history entries by text content.
 */
export function searchHistory(query: string): ClipboardEntry[] {
    if (!query) return getHistory().slice(0, 20);
    const lower = query.toLowerCase();
    return history.filter(
        e => e.type === 'text' && e.content.toLowerCase().includes(lower)
    ).slice(0, 20);
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
    const idx = history.findIndex(e => e.id === id);
    if (idx === -1) return;

    const entry = history[idx]!;
    if (entry.type === 'image') {
        deleteImageFile(entry.content);
    }
    history.splice(idx, 1);
    saveHistory();
}

/**
 * Toggle the pinned state of a history entry.
 */
export function togglePin(id: string): void {
    const entry = history.find(e => e.id === id);
    if (!entry) return;
    entry.pinned = !entry.pinned;
    saveHistory();
}

/**
 * Clear all unpinned history entries.
 */
export function clearHistory(): void {
    // Delete image files for unpinned entries
    for (const entry of history) {
        if (!entry.pinned && entry.type === 'image') {
            deleteImageFile(entry.content);
        }
    }
    history = history.filter(e => e.pinned);
    saveHistory();
}