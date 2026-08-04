/**
 * @deprecated Use `#/lib/services/clipboard/history` directly instead.
 *
 * This module is a thin compatibility wrapper that converts the modern
 * `ClipboardEntry`-based API from `history.ts` into a callback-based
 * interface with `ClipboardItem` types. New code should import from
 * `history.ts` directly for a simpler, promise-based API.
 *
 * Migrate:
 *   `getClipboardHistory(cb)` → `const entries = getHistory()`
 *   `searchClipboard(q, cb)`  → `const results = searchHistory(q)`
 *   `ClipboardItem`           → `ClipboardEntry`
 */

import Gdk from 'gi://Gdk?version=4.0';
import logger from '@shade/core/logger';
import type {ClipboardEntry} from './history';
import {copyEntryToClipboard, deleteEntry, getHistory, searchHistory} from './history';

/** @deprecated Use ClipboardEntry from clipboardHistory instead. */
export interface ClipboardItem {
    id: string;
    text: string;
    timestamp: number;
}

function entryToItem(entry: ClipboardEntry): ClipboardItem {
    return {
        id: entry.id,
        text: entry.type === 'text' ? entry.content : '[Image]',
        timestamp: entry.timestamp,
    };
}

export async function getClipboardHistory(callback: (items: ClipboardItem[]) => void) {
    try {
        const entries = getHistory();
        callback(entries.map(entryToItem));
    } catch (e) {
        logger.error('clipboard', 'failed to get history:', e);
        callback([]);
    }
}

export async function searchClipboard(query: string, callback: (items: ClipboardItem[]) => void) {
    try {
        if (!query) {
            const entries = getHistory().slice(0, 20);
            callback(entries.map(entryToItem));
            return;
        }
        const entries = searchHistory(query);
        callback(entries.map(entryToItem));
    } catch (e) {
        logger.error('clipboard', 'failed to search history:', e);
        callback([]);
    }
}

export async function copyClipboardItem(item: ClipboardEntry) {
    try {
        // Find the actual entry in our history to get the full record
        const entries = getHistory();
        const entry = entries.find((e) => e.id === item.id);
        if (entry) {
            await copyEntryToClipboard(entry);
        } else {
            // Fallback: if the entry isn't found (shouldn't happen), try to
            // reconstruct from the ClipboardItem. For text, use the text field.
            // For images, we can't reconstruct without the file.
            logger.warn('clipboard', 'entry not found in history, creating from item');
            const display = Gdk.Display.get_default();
            if (display) {
                display.get_clipboard().set(item.content);
            }
        }
    } catch (e) {
        logger.error('clipboard', 'failed to copy item:', e);
    }
}

export async function deleteClipboardItem(id: string) {
    try {
        deleteEntry(id);
    } catch (e) {
        logger.error('clipboard', 'failed to delete item:', e);
    }
}

export function isImageEntry(text: string): boolean {
    return (
        text.startsWith('[[ binary data ') ||
        text.includes('image/png') ||
        text.includes('image/jpeg')
    );
}

export function formatClipboardPreview(text: string, maxLen = 60): string {
    if (isImageEntry(text)) return '[Image]';
    if (text.length > maxLen) return text.slice(0, maxLen) + '...';
    return text;
}
