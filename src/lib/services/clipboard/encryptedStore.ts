/**
 * EncryptedStore — Encrypted SQLite-backed clipboard history storage.
 *
 * Uses Gda-6.0 for SQLite database access, with AES-256-GCM encryption
 * for the on-disk file. The database is kept in a temporary file and
 * encrypted to `~/.local/share/shade-shell/clipboard-history.enc` on save.
 *
 * @module encryptedStore
 */

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gda from 'gi://Gda?version=6.0';
import {encrypt, decrypt} from './cryptoEngine';
import {getKey, initKeyManager} from './keyManager';
import logger from '#/lib/core/logger';

export type ClipboardEntry = {
    id: string;
    type: 'text' | 'image';
    /** For text: the full text content. For images: filename in the clipboard dir. */
    content: string;
    mimeType: string;
    timestamp: number;
    pinned: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────────

const DATA_DIR = `${GLib.get_user_data_dir()}/shade-shell`;
const HISTORY_FILE = `${DATA_DIR}/clipboard-history.enc`;
const DB_DIR = `${DATA_DIR}/db`;
const DB_FILE = `${DB_DIR}/clipboard.db`;

const MAGIC = 0x53484544; // "SHED" as uint32 LE
const VERSION = 1;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

const MAX_HISTORY = 100;

// ── State ────────────────────────────────────────────────────────────────────

let connection: Gda.Connection | null = null;
let encryptionKey: Uint8Array | null = null;

// ── File helpers ─────────────────────────────────────────────────────────────

function ensureDirs(): void {
    GLib.mkdir_with_parents(DB_DIR, 0o755);
}

// ── Database management ──────────────────────────────────────────────────────

/**
 * Create the entries table if it doesn't exist.
 */
function ensureSchema(): void {
    if (!connection) throw new Error('EncryptedStore not initialized');
    connection.execute_non_select_command(
        `CREATE TABLE IF NOT EXISTS entries (
            id        TEXT PRIMARY KEY,
            type      TEXT NOT NULL CHECK(type IN ('text','image')),
            content   TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            pinned    INTEGER NOT NULL DEFAULT 0
        )`
    );
}

/**
 * Open the SQLite database from the file, creating it if it doesn't exist.
 */
function openDatabase(): void {
    ensureDirs();

    // Create the database file if it doesn't exist, then open it
    if (!Gio.File.new_for_path(DB_FILE).query_exists(null)) {
        // Create an empty database file by opening and closing a connection
        const initConn = Gda.Connection.new_from_string(
            'SQLite',
            `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
            null,
            Gda.ConnectionOptions.READ_WRITE
        );
        initConn.execute_non_select_command(
            `CREATE TABLE entries (
                id        TEXT PRIMARY KEY,
                type      TEXT NOT NULL CHECK(type IN ('text','image')),
                content   TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                pinned    INTEGER NOT NULL DEFAULT 0
            )`
        );
        initConn.execute_non_select_command(
            `CREATE INDEX idx_entries_timestamp ON entries(timestamp DESC)`
        );
        initConn.execute_non_select_command(
            `CREATE INDEX idx_entries_content ON entries(content)`
        );
        initConn.close();
    }

    connection = Gda.Connection.new_from_string(
        'SQLite',
        `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
        null,
        Gda.ConnectionOptions.READ_WRITE
    );

    logger.info('clipboard', 'SQLite database opened');
}


/**
 * Close the SQLite database connection.
 */
function closeDatabase(): void {
    if (connection) {
        try {
            connection.close();
        } catch (e) {
            logger.warn('clipboard', 'error closing database:', e);
        }
        connection = null;
    }
}

// ── Encrypted file I/O ───────────────────────────────────────────────────────

/**
 * Read and decrypt the clipboard history file.
 *
 * Returns true if the file was loaded successfully (or doesn't exist yet).
 */
function loadEncryptedFile(): boolean {
    const file = Gio.File.new_for_path(HISTORY_FILE);
    if (!file.query_exists(null)) {
        logger.info('clipboard', 'no encrypted history file found, starting fresh');
        return true;
    }

    try {
        const [, contents] = file.load_contents(null);
        if (!contents || contents.length === 0) {
            logger.warn('clipboard', 'empty encrypted history file');
            return true;
        }

        const data = new Uint8Array(contents);

        // Verify magic
        const magic =
            (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        if (magic !== MAGIC) {
            logger.warn('clipboard', 'invalid magic bytes in encrypted file');
            return true; // Start fresh
        }

        // Read version
        const version =
            (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
        if (version !== VERSION) {
            logger.warn(
                'clipboard',
                `unsupported encrypted file version: ${version}`
            );
            return true;
        }

        // Parse: [magic 4][version 4][nonce 12][encrypted blob variable][tag 16]
        const nonce = data.subarray(8, 8 + NONCE_SIZE);
        const encryptedBlob = data.subarray(
            8 + NONCE_SIZE,
            data.length - TAG_SIZE
        );
        const tag = data.subarray(data.length - TAG_SIZE);

        // Reconstruct the format expected by decrypt(): [nonce][ciphertext][tag]
        const decryptInput = new Uint8Array(
            NONCE_SIZE + encryptedBlob.length + TAG_SIZE
        );
        decryptInput.set(nonce);
        decryptInput.set(encryptedBlob, NONCE_SIZE);
        decryptInput.set(tag, NONCE_SIZE + encryptedBlob.length);

        // Decrypt
        const decrypted = decrypt(encryptionKey!, decryptInput);

        // Write decrypted data to the SQLite database file
        GLib.file_set_contents(DB_FILE, decrypted);

        logger.info(
            'clipboard',
            `decrypted history file (${decrypted.length} bytes)`
        );
        return true;
    } catch (e) {
        logger.warn('clipboard', 'failed to decrypt history file, starting fresh:', e);
        // If decryption fails, remove the corrupted file and start fresh
        try {
            file.delete(null);
        } catch {
            // Ignore delete errors
        }
        return true;
    }
}

/**
 * Encrypt the current SQLite database and save to the history file.
 */
function saveEncryptedFile(): boolean {
    if (!connection) return false;

    try {
        // Close the connection to flush any pending writes
        connection.close();

        // Read the database file directly
        const file = Gio.File.new_for_path(DB_FILE);
        if (!file.query_exists(null)) {
            logger.warn('clipboard', 'database file not found for save');
            // Reopen the connection
            connection = Gda.Connection.new_from_string(
                'SQLite',
                `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
                null,
                Gda.ConnectionOptions.READ_WRITE
            );
            return false;
        }

        const [, contents] = file.load_contents(null);
        if (!contents) {
            logger.warn('clipboard', 'database file is empty');
            // Reopen the connection
            connection = Gda.Connection.new_from_string(
                'SQLite',
                `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
                null,
                Gda.ConnectionOptions.READ_WRITE
            );
            return false;
        }

        const dbBytes = new Uint8Array(contents);

        // Encrypt
        const encrypted = encrypt(encryptionKey!, dbBytes);

        // Parse: [nonce 12][ciphertext variable][tag 16]
        const nonce = encrypted.subarray(0, NONCE_SIZE);
        const ciphertext = encrypted.subarray(NONCE_SIZE, encrypted.length - TAG_SIZE);
        const tag = encrypted.subarray(encrypted.length - TAG_SIZE);

        // Write encrypted file: [magic 4][version 4][nonce 12][ciphertext][tag 16]
        const output = new Uint8Array(4 + 4 + NONCE_SIZE + ciphertext.length + TAG_SIZE);
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

        // Atomic write
        GLib.file_set_contents(HISTORY_FILE, output);

        // Reopen the database connection
        connection = Gda.Connection.new_from_string(
            'SQLite',
            `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
            null,
            Gda.ConnectionOptions.READ_WRITE
        );

        logger.info(
            'clipboard',
            `encrypted history saved (${output.length} bytes)`
        );
        return true;
    } catch (e) {
        logger.error('clipboard', 'failed to save encrypted history:', e);
        // Try to reopen the connection
        try {
            if (!connection) {
                connection = Gda.Connection.new_from_string(
                    'SQLite',
                    `DB_DIR=${DB_DIR};DB_NAME=clipboard.db`,
                    null,
                    Gda.ConnectionOptions.READ_WRITE
                );
            }
        } catch {
            // Ignore reopen errors
        }
        return false;
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the encrypted store.
 *
 * Must be called once before any other operations.
 */
export function initStore(): void {
    if (connection) return;

    // Initialize key manager (deferred — will look up keyring on next loop iteration)
    initKeyManager();

    // Get encryption key (may be ephemeral if keyring not ready yet)
    encryptionKey = getKey();

    // Load and decrypt the history file
    loadEncryptedFile();

    // Open the SQLite database
    openDatabase();
}

/**
 * Shut down the store, saving pending changes.
 */
export function shutdownStore(): void {
    saveEncryptedFile();
    closeDatabase();
    encryptionKey = null;
}

/**
 * Get all clipboard entries, most recent first.
 */
export function getAllEntries(): ClipboardEntry[] {
    if (!connection) return [];
    try {
        const dataModel = connection.execute_select_command(
            'SELECT id, type, content, mime_type, timestamp, pinned FROM entries ORDER BY timestamp DESC'
        );
        const rows = dataModel.get_n_rows();
        const entries: ClipboardEntry[] = [];
        for (let i = 0; i < rows; i++) {
            entries.push(rowToEntry(dataModel, i));
        }
        return entries;
    } catch (e) {
        logger.error('clipboard', 'failed to query entries:', e);
        return [];
    }
}

/**
 * Search clipboard entries by text content.
 */
export function searchEntries(query: string): ClipboardEntry[] {
    if (!connection) return [];
    try {
        if (!query) {
            return getAllEntries().slice(0, 20);
        }
        const dataModel = connection.execute_select_command(
            `SELECT id, type, content, mime_type, timestamp, pinned
             FROM entries
             WHERE type = 'text' AND LOWER(content) LIKE '%' || LOWER(?) || '%'
             ORDER BY timestamp DESC
             LIMIT 20`,
            [query]
        );
        const rows = dataModel.get_n_rows();
        const entries: ClipboardEntry[] = [];
        for (let i = 0; i < rows; i++) {
            entries.push(rowToEntry(dataModel, i));
        }
        return entries;
    } catch (e) {
        logger.error('clipboard', 'failed to search entries:', e);
        return [];
    }
}

/**
 * Add a new clipboard entry.
 */
export function addEntry(entry: ClipboardEntry): void {
    if (!connection) return;
    try {
        connection.execute_non_select_command(
            `INSERT OR REPLACE INTO entries (id, type, content, mime_type, timestamp, pinned)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                entry.type,
                entry.content,
                entry.mimeType,
                entry.timestamp,
                entry.pinned ? 1 : 0,
            ]
        );

        // Evict oldest unpinned entries beyond the limit
        connection.execute_non_select_command(
            `DELETE FROM entries WHERE id IN (
                SELECT id FROM entries WHERE pinned = 0
                ORDER BY timestamp DESC
                LIMIT -1 OFFSET ?
            )`,
            [MAX_HISTORY]
        );

        saveEncryptedFile();
    } catch (e) {
        logger.error('clipboard', 'failed to add entry:', e);
    }
}

/**
 * Delete a clipboard entry by ID.
 */
export function deleteEntry(id: string): void {
    if (!connection) return;
    try {
        connection.execute_non_select_command(
            'DELETE FROM entries WHERE id = ?',
            [id]
        );
        saveEncryptedFile();
    } catch (e) {
        logger.error('clipboard', 'failed to delete entry:', e);
    }
}

/**
 * Toggle the pinned state of a clipboard entry.
 */
export function togglePin(id: string): void {
    if (!connection) return;
    try {
        connection.execute_non_select_command(
            'UPDATE entries SET pinned = CASE WHEN pinned = 0 THEN 1 ELSE 0 END WHERE id = ?',
            [id]
        );
        saveEncryptedFile();
    } catch (e) {
        logger.error('clipboard', 'failed to toggle pin:', e);
    }
}

/**
 * Delete all unpinned entries.
 */
export function clearHistory(): void {
    if (!connection) return;
    try {
        connection.execute_non_select_command(
            "DELETE FROM entries WHERE pinned = 0"
        );
        saveEncryptedFile();
    } catch (e) {
        logger.error('clipboard', 'failed to clear history:', e);
    }
}

/**
 * Find a single entry by ID.
 */
export function getEntry(id: string): ClipboardEntry | null {
    if (!connection) return null;
    try {
        const dataModel = connection.execute_select_command(
            'SELECT id, type, content, mime_type, timestamp, pinned FROM entries WHERE id = ?',
            [id]
        );
        if (dataModel.get_n_rows() > 0) {
            return rowToEntry(dataModel, 0);
        }
        return null;
    } catch (e) {
        logger.error('clipboard', 'failed to get entry:', e);
        return null;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Gda data model row to a ClipboardEntry.
 */
function rowToEntry(dataModel: Gda.DataModel, row: number): ClipboardEntry {
    return {
        id: dataModel.get_value_at(0, row) as string,
        type: dataModel.get_value_at(1, row) as 'text' | 'image',
        content: dataModel.get_value_at(2, row) as string,
        mimeType: dataModel.get_value_at(3, row) as string,
        timestamp: dataModel.get_value_at(4, row) as number,
        pinned: (dataModel.get_value_at(5, row) as number) === 1,
    };
}