/**
 * EncryptedStore — AES-256-GCM encrypted clipboard history storage.
 *
 * Clipboard entries are stored in memory and encrypted to disk as a
 * JSON blob. The encryption key is stored in the system keyring via
 * libsecret.
 *
 * File format (.enc):
 *   [magic: "SHED" 4 bytes][version: uint32 4 bytes]
 *   [nonce: 12 bytes][encrypted JSON blob: variable][auth tag: 16 bytes]
 *
 * @module encryptedStore
 */

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {encrypt, decrypt} from './cryptoEngine';
import {getKey, initKeyManager} from './keyManager';
import logger from '#/lib/core/logger';

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

const DATA_DIR = `${GLib.get_user_data_dir()}/shade-shell`;
const HISTORY_FILE = `${DATA_DIR}/clipboard-history.enc`;
const CLIPBOARD_DIR = `${DATA_DIR}/clipboard`;

const MAGIC = 0x53484544; // "SHED" as uint32 LE
const VERSION = 1;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

const MAX_HISTORY = 100;

// ── State ────────────────────────────────────────────────────────────────────

let entries: ClipboardEntry[] = [];
let encryptionKey: Uint8Array | null = null;

// ── File helpers ─────────────────────────────────────────────────────────────

function ensureDirs(): void {
    GLib.mkdir_with_parents(DATA_DIR, 0o755);
    GLib.mkdir_with_parents(CLIPBOARD_DIR, 0o755);
}

// ── Encrypted file I/O ───────────────────────────────────────────────────────

interface HistoryData {
    entries: ClipboardEntry[];
}

/**
 * Decrypt and load the clipboard history file.
 */
function loadEncryptedFile(): void {
    const file = Gio.File.new_for_path(HISTORY_FILE);
    if (!file.query_exists(null)) {
        logger.info('clipboard', 'no encrypted history file found, starting fresh');
        return;
    }

    try {
        const [, contents] = file.load_contents(null);
        if (!contents || contents.length === 0) {
            logger.warn('clipboard', 'empty encrypted history file');
            return;
        }

        const data = new Uint8Array(contents);

        // Verify magic
        const magic =
            (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        if (magic !== MAGIC) {
            logger.warn('clipboard', 'invalid magic bytes in encrypted file');
            return;
        }

        // Read version
        const version =
            (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
        if (version !== VERSION) {
            logger.warn('clipboard', `unsupported encrypted file version: ${version}`);
            return;
        }

        // Parse: [magic 4][version 4][nonce 12][encrypted blob][tag 16]
        const nonce = data.subarray(8, 8 + NONCE_SIZE);
        const encryptedBlob = data.subarray(8 + NONCE_SIZE, data.length - TAG_SIZE);
        const tag = data.subarray(data.length - TAG_SIZE);

        // Reconstruct format: [nonce][ciphertext][tag]
        const decryptInput = new Uint8Array(
            NONCE_SIZE + encryptedBlob.length + TAG_SIZE
        );
        decryptInput.set(nonce);
        decryptInput.set(encryptedBlob, NONCE_SIZE);
        decryptInput.set(tag, NONCE_SIZE + encryptedBlob.length);

        // Decrypt
        const decrypted = decrypt(encryptionKey!, decryptInput);

        // Parse JSON
        const decoder = new TextDecoder();
        const parsed: HistoryData = JSON.parse(decoder.decode(decrypted));
        entries = parsed.entries || [];

        logger.info('clipboard', `decrypted history (${entries.length} entries)`);
    } catch (e) {
        logger.warn('clipboard', 'failed to decrypt history file, starting fresh:', e);
        entries = [];
        // Remove corrupted file
        try { file.delete(null); } catch { /* ignore */ }
    }
}

/**
 * Encrypt and save the clipboard history file.
 */
function saveEncryptedFile(): void {
    try {
        ensureDirs();

        // Serialize to JSON
        const data: HistoryData = {entries};
        const encoder = new TextEncoder();
        const jsonBytes = encoder.encode(JSON.stringify(data));

        // Encrypt
        const encrypted = encrypt(encryptionKey!, jsonBytes);

        // Parse: [nonce 12][ciphertext variable][tag 16]
        const nonce = encrypted.subarray(0, NONCE_SIZE);
        const ciphertext = encrypted.subarray(NONCE_SIZE, encrypted.length - TAG_SIZE);
        const tag = encrypted.subarray(encrypted.length - TAG_SIZE);

        // Write file: [magic 4][version 4][nonce 12][ciphertext][tag 16]
        const output = new Uint8Array(
            4 + 4 + NONCE_SIZE + ciphertext.length + TAG_SIZE
        );
        // Magic
        output[0] = (MAGIC >>> 24) & 0xff;
        output[1] = (MAGIC >>> 16) & 0xff;
        output[2] = (MAGIC >>> 8) & 0xff;
        output[3] = MAGIC & 0xff;
        // Version
        output[4] = (VERSION >>> 24) & 0xff;
        output[5] = (VERSION >>> 16) & 0xff;
        output[6] = (VERSION >>> 8) & 0xff;
        output[7] = VERSION & 0xff;
        // Nonce
        output.set(nonce, 8);
        // Ciphertext
        output.set(ciphertext, 8 + NONCE_SIZE);
        // Tag
        output.set(tag, 8 + NONCE_SIZE + ciphertext.length);

        GLib.file_set_contents(HISTORY_FILE, output);

        logger.debug('clipboard', `encrypted history saved (${output.length} bytes)`);
    } catch (e) {
        logger.error('clipboard', 'failed to save encrypted history:', e);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the encrypted store.
 *
 * Must be called once before any other operations.
 */
export function initStore(): void {
    if (encryptionKey) return;

    // Initialize key manager
    initKeyManager();

    // Get encryption key
    encryptionKey = getKey();

    // Load and decrypt the history file
    loadEncryptedFile();
}

/**
 * Shut down the store, saving pending changes.
 */
export function shutdownStore(): void {
    saveEncryptedFile();
    encryptionKey = null;
    entries = [];
}

/**
 * Get all clipboard entries, most recent first.
 */
export function getAllEntries(): ClipboardEntry[] {
    return [...entries];
}

/**
 * Search clipboard entries by text content.
 */
export function searchEntries(query: string): ClipboardEntry[] {
    if (!query) return [...entries].slice(0, 20);
    const lower = query.toLowerCase();
    return entries.filter(
        e => e.type === 'text' && e.content.toLowerCase().includes(lower)
    ).slice(0, 20);
}

/**
 * Add a new clipboard entry.
 */
export function addEntry(entry: ClipboardEntry): void {
    // Deduplicate: skip if the last entry is identical
    if (entry.type === 'text' && entries.length > 0) {
        const last = entries[0]!;
        if (last.type === 'text' && last.content === entry.content) {
            return;
        }
    }

    // Insert at front
    entries.unshift(entry);

    // Evict oldest unpinned entries beyond limit
    if (entries.length > MAX_HISTORY) {
        const targetEvict = entries.length - MAX_HISTORY;
        if (targetEvict > 0) {
            let evicted = 0;
            for (let i = entries.length - 1; i >= 0 && evicted < targetEvict; i--) {
                if (!entries[i]!.pinned) {
                    if (entries[i]!.type === 'image') {
                        deleteImageFile(entries[i]!.content);
                    }
                    entries.splice(i, 1);
                    evicted++;
                }
            }
        }
    }

    saveEncryptedFile();
}

/**
 * Delete a clipboard entry by ID.
 */
export function deleteEntry(id: string): void {
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return;

    if (entries[idx]!.type === 'image') {
        deleteImageFile(entries[idx]!.content);
    }
    entries.splice(idx, 1);
    saveEncryptedFile();
}

/**
 * Toggle the pinned state of a clipboard entry.
 */
export function togglePin(id: string): void {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    entry.pinned = !entry.pinned;
    saveEncryptedFile();
}

/**
 * Delete all unpinned entries.
 */
export function clearHistory(): void {
    for (const entry of entries) {
        if (!entry.pinned && entry.type === 'image') {
            deleteImageFile(entry.content);
        }
    }
    entries = entries.filter(e => e.pinned);
    saveEncryptedFile();
}

/**
 * Find a single entry by ID.
 */
export function getEntry(id: string): ClipboardEntry | null {
    return entries.find(e => e.id === id) ?? null;
}

/**
 * Delete an image file from the clipboard directory.
 */
function deleteImageFile(filename: string): void {
    try {
        const file = Gio.File.new_for_path(`${CLIPBOARD_DIR}/${filename}`);
        if (file.query_exists(null)) {
            file.delete(null);
        }
    } catch (e) {
        logger.warn('clipboard', 'failed to delete image file:', e);
    }
}