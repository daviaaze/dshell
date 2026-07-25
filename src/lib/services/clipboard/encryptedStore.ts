/**
 * EncryptedStore — AES-256-GCM encrypted clipboard history storage.
 *
 * Clipboard entries are held in memory and encrypted to disk as a
 * single JSON blob. The encryption key is stored in the system keyring
 * via libsecret.
 *
 * File format (.enc):
 *   [magic: "SHED" 4 bytes][version: uint32 4 bytes]
 *   [nonce: 12 bytes][encrypted JSON blob: variable][auth tag: 16 bytes]
 *
 * Image data is stored as base64 inside the JSON blob, not as separate
 * files on disk (replaces legacy clipboard/<filename>.png approach).
 *
 * Emits 'entries-changed' on every mutation so UIs can react.
 *
 * @module encryptedStore
 */

import {Object, register, signal} from 'gnim/gobject';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {encrypt, decrypt} from './cryptoEngine';
import {getKey, initKeyManager} from './keyManager';
import logger from '#/lib/core/logger';

export interface ClipboardEntry {
    id: string;
    type: 'text' | 'image';
    /** For text: the full text. For images: base64-encoded binary data. */
    content: string;
    mimeType: string;
    timestamp: number;
    pinned: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DATA_DIR = `${GLib.get_user_data_dir()}/shade-shell`;
const HISTORY_FILE = `${DATA_DIR}/clipboard-history.enc`;
const LEGACY_CLIPBOARD_DIR = `${DATA_DIR}/clipboard`;

const MAGIC = 0x53484544; // "SHED" as uint32 LE
const VERSION = 1;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

const MAX_HISTORY = 100;
const LEGACY_PNG_RE = /^clipboard-\d+\.png$/;

// ── Singleton service ────────────────────────────────────────────────────────

@register({GTypeName: 'EncryptedStore'})
export class EncryptedStore extends Object {
    static instance: EncryptedStore;

    static get_default() {
        if (!this.instance) {
            this.instance = new EncryptedStore();
        }
        return this.instance;
    }

    #entries: ClipboardEntry[] = [];
    #encryptionKey: Uint8Array | null = null;
    #ready = false;

    /** Emitted after every mutation (add, delete, toggle, clear). */
    @signal([])
    entriesChanged() {}

    // ── Initialisation ───────────────────────────────────────────────────

    /**
     * Initialize the encrypted store.
     *
     * Must be called once before any other operations.
     * After this, `#ready` is true.
     *
     * @param testKey — Optional 32-byte key for testing (skips secret service).
     */
    init(testKey?: Uint8Array): void {
        if (this.#ready) return;

        if (testKey) {
            this.#encryptionKey = testKey;
        } else {
            initKeyManager();
            this.#encryptionKey = getKey();
        }
        this.#loadEncryptedFile();
        this.#migrateLegacyImages();
        this.#ready = true;
        logger.info('clipboard', `store initialised (${this.#entries.length} entries)`);
    }

    /** True after `init()` has been called successfully. */
    get ready(): boolean {
        return this.#ready;
    }

    // ── Public query API ──────────────────────────────────────────────────

    /** Return a shallow copy of all entries, newest first. */
    getAllEntries(): ClipboardEntry[] {
        return [...this.#entries];
    }

    /** Search text entries by substring (case-insensitive). Top 20. */
    searchEntries(query: string): ClipboardEntry[] {
        if (!query) return [...this.#entries].slice(0, 20);
        const lower = query.toLowerCase();
        return this.#entries.filter(
            e => e.type === 'text' && e.content.toLowerCase().includes(lower)
        ).slice(0, 20);
    }

    /** Find a single entry by id. */
    getEntry(id: string): ClipboardEntry | null {
        return this.#entries.find(e => e.id === id) ?? null;
    }

    // ── Mutations ─────────────────────────────────────────────────────────

    /**
     * Add a new entry, deduplicating by content:
     *   - text: if the same text exists anywhere in history, move to front
     *   - image: if the same base64 content exists, move to front
     *
     * If the clipboard contains both text _and_ image for the same copy,
     * both entries are kept (different types, both valid). Move-to-front
     * dedup prevents the type-specific duplicates that wl-paste can emit.
     */
    addEntry(entry: ClipboardEntry): void {
        this.#ensureReady();

        // Move-to-front dedup — find matching content of the same type
        const dupIdx = this.#entries.findIndex(
            e => e.type === entry.type && e.content === entry.content
        );

        if (dupIdx !== -1) {
            // Move existing entry to front, update its timestamp
            const existing = this.#entries.splice(dupIdx, 1)[0]!;
            existing.timestamp = entry.timestamp;
            this.#entries.unshift(existing);
            this.#save();
            return;
        }

        // New entry — insert at front
        this.#entries.unshift(entry);

        // Evict oldest unpinned entries if over limit
        if (this.#entries.length > MAX_HISTORY) {
            const toEvict = this.#entries.length - MAX_HISTORY;
            for (let i = this.#entries.length - 1; i >= 0 && toEvict > 0; i--) {
                if (!this.#entries[i]!.pinned) {
                    this.#entries.splice(i, 1);
                }
            }
        }

        this.#save();
    }

    /** Remove an entry by id. */
    deleteEntry(id: string): void {
        this.#ensureReady();
        const idx = this.#entries.findIndex(e => e.id === id);
        if (idx === -1) return;
        this.#entries.splice(idx, 1);
        this.#save();
    }

    /** Toggle pinned state. */
    togglePin(id: string): void {
        this.#ensureReady();
        const entry = this.#entries.find(e => e.id === id);
        if (!entry) return;
        entry.pinned = !entry.pinned;
        this.#save();
    }

    /** Remove all unpinned entries. */
    clearHistory(): void {
        this.#ensureReady();
        this.#entries = this.#entries.filter(e => e.pinned);
        this.#save();
    }

    /**
     * Shut down (save then release key). Safe to call multiple times.
     */
    shutdown(): void {
        if (!this.#ready) return;
        this.#save();
        this.#encryptionKey = null;
        this.#entries = [];
        this.#ready = false;
    }

    /**
     * Reset internal state for testing. Clears entries and removes the
     * encrypted file so the next `init()` starts fresh.
     */
    testReset(): void {
        this.#entries = [];
        this.#encryptionKey = null;
        this.#ready = false;
        try {
            Gio.File.new_for_path(HISTORY_FILE).delete(null);
        } catch {
            // file may not exist
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────

    #ensureReady(): void {
        if (!this.#ready) {
            throw new Error('EncryptedStore not initialised — call init() first');
        }
    }

    #emitChanged(): void {
        this.entriesChanged();
    }

    // ── Encrypted file I/O ────────────────────────────────────────────────

    #loadEncryptedFile(): void {
        const file = Gio.File.new_for_path(HISTORY_FILE);
        if (!file.query_exists(null)) {
            logger.info('clipboard', 'no history file yet, starting fresh');
            return;
        }

        try {
            const [, contents] = file.load_contents(null);
            if (!contents || contents.length === 0) {
                logger.warn('clipboard', 'empty history file');
                return;
            }

            const data = new Uint8Array(contents);

            // Verify magic
            const magic =
                (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
            if (magic !== MAGIC) {
                logger.warn('clipboard', 'invalid magic in encrypted file');
                return;
            }

            // Verify version
            const version =
                (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
            if (version !== VERSION) {
                logger.warn('clipboard', `unsupported file version: ${version}`);
                // Don't clear — old version might still be readable
                return;
            }

            // Parse layout
            const nonce = data.subarray(8, 8 + NONCE_SIZE);
            const ciphertext = data.subarray(8 + NONCE_SIZE, data.length - TAG_SIZE);
            const tag = data.subarray(data.length - TAG_SIZE);

            // Reconstruct [nonce][ciphertext][tag] for decrypt
            const decryptInput = new Uint8Array(
                NONCE_SIZE + ciphertext.length + TAG_SIZE
            );
            decryptInput.set(nonce);
            decryptInput.set(ciphertext, NONCE_SIZE);
            decryptInput.set(tag, NONCE_SIZE + ciphertext.length);

            const decrypted = decrypt(this.#encryptionKey!, decryptInput);

            const decoder = new TextDecoder();
            const parsed: {entries: ClipboardEntry[]} = JSON.parse(
                decoder.decode(decrypted)
            );
            this.#entries = parsed.entries || [];
            logger.info('clipboard', `loaded ${this.#entries.length} entries`);
        } catch (e) {
            logger.warn('clipboard', 'failed to load history, starting fresh:', e);
            this.#entries = [];
            try {
                file.delete(null);
            } catch {
                /* ignore */
            }
        }
    }

    #save(): void {
        if (!this.#encryptionKey) {
            logger.warn('clipboard', 'no encryption key, skipping save');
            return;
        }

        try {
            GLib.mkdir_with_parents(DATA_DIR, 0o755);

            const encoder = new TextEncoder();
            const jsonBytes = encoder.encode(
                JSON.stringify({entries: this.#entries})
            );

            const encrypted = encrypt(this.#encryptionKey!, jsonBytes);

            const nonce = encrypted.subarray(0, NONCE_SIZE);
            const ciphertext = encrypted.subarray(
                NONCE_SIZE,
                encrypted.length - TAG_SIZE
            );
            const tag = encrypted.subarray(encrypted.length - TAG_SIZE);

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
            this.#emitChanged();
        } catch (e) {
            logger.error('clipboard', 'failed to save encrypted history:', e);
        }
    }

    // ── Legacy migration ──────────────────────────────────────────────────

    /**
     * Old format stored image bytes as separate PNG files referenced by
     * filename. Convert those entries to inline base64 content, then
     * delete the legacy clipboard directory.
     */
    #migrateLegacyImages(): void {
        let migrated = 0;

        for (const entry of this.#entries) {
            if (entry.type !== 'image') continue;
            if (!LEGACY_PNG_RE.test(entry.content)) continue;

            const filePath = `${LEGACY_CLIPBOARD_DIR}/${entry.content}`;
            const file = Gio.File.new_for_path(filePath);
            if (!file.query_exists(null)) {
                logger.warn('clipboard', 'legacy image file missing, skipping:', filePath);
                continue;
            }

            try {
                const [, bytes] = file.load_contents(null);
                if (bytes) {
                    // Encode raw bytes to base64 and store inline
                    entry.content = GLib.base64_encode(new Uint8Array(bytes));
                    migrated++;
                }
            } catch (e) {
                logger.warn('clipboard', 'failed to migrate legacy image:', filePath, e);
            }
        }

        if (migrated > 0) {
            logger.info('clipboard', `migrated ${migrated} legacy image(s) to inline base64`);
            this.#save();

            // Clean up legacy directory
            try {
                const dir = Gio.File.new_for_path(LEGACY_CLIPBOARD_DIR);
                if (dir.query_exists(null)) {
                    dir.delete(null);
                }
            } catch (e) {
                logger.warn('clipboard', 'could not remove legacy clipboard dir:', e);
            }
        }
    }
}

// ── Convenience singleton re-exports ─────────────────────────────────────────
// These match the previous function-based API so consumers don't break.

export function initStore(): void {
    EncryptedStore.get_default().init();
}

export function getAllEntries(): ClipboardEntry[] {
    return EncryptedStore.get_default().getAllEntries();
}

export function searchEntries(query: string): ClipboardEntry[] {
    return EncryptedStore.get_default().searchEntries(query);
}

export function addEntry(entry: ClipboardEntry): void {
    EncryptedStore.get_default().addEntry(entry);
}

export function deleteEntry(id: string): void {
    EncryptedStore.get_default().deleteEntry(id);
}

export function togglePin(id: string): void {
    EncryptedStore.get_default().togglePin(id);
}

export function clearHistory(): void {
    EncryptedStore.get_default().clearHistory();
}

export function getEntry(id: string): ClipboardEntry | null {
    return EncryptedStore.get_default().getEntry(id);
}

export function shutdownStore(): void {
    EncryptedStore.get_default().shutdown();
}
