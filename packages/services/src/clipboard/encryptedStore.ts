/**
 * EncryptedStore — encrypted clipboard history storage (v3, native crypto).
 *
 * Clipboard entries are held in memory and encrypted to disk as a
 * single JSON blob. The encryption key is stored in the system keyring
 * via libsecret.
 *
 * Crypto: AES-256-CTR + HMAC-SHA256 (encrypt-then-MAC) via the `openssl`
 * binary (nativeCrypto.ts), replacing the pure-JS AES-256-GCM that ran at
 * ~2.8 MB/s and froze the main loop for 62 s on a large history.
 *
 * File format (.enc) v3:
 *   [magic: "SHED" 4 bytes][version: uint32 4 bytes]
 *   [nonceLen: 1 byte][nonce][macLen: 1 byte][mac][ciphertext...]
 *
 * Design for startup safety:
 *   - The initial load is async (`initAsync`), scheduled off the init path.
 *   - Writes are debounced (1.5 s) and flushed asynchronously, so a large
 *     blob never rewrites/encrypts synchronously on the main loop.
 *   - History is capped at MAX_HISTORY entries AND MAX_TOTAL_BYTES plaintext
 *     (oldest unpinned evicted), so disk size stays bounded.
 *   - Copies that arrive before the first load completes are buffered in
 *     `#pending` and merged when the load finishes.
 *
 * Emits 'entries-changed' when a flush actually persists, so UIs can react.
 *
 * @module encryptedStore
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Timeout} from '@shade/core/timeout';
import logger from '@shade/core/logger';
import {Object, register, signal} from 'gnim/gobject';
import {decryptNative, encryptNative, type SealedBlob} from './nativeCrypto';
import {getKey, initKeyManager, isKeyPersistent} from './keyManager';

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

const MAGIC = 0x53484544; // "SHED" as uint32 BE
const VERSION = 3;

const MAX_HISTORY = 500;
/** Hard cap on serialized plaintext size — bounded disk regardless of images. */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 1500;
const LEGACY_PNG_RE = /^clipboard-\d+\.png$/;

// ── Singleton service ────────────────────────────────────────────────────────

@register
export class EncryptedStore extends Object {
    private static instance: EncryptedStore;

    static get_default() {
        if (!EncryptedStore.instance) {
            EncryptedStore.instance = new EncryptedStore();
        }
        return EncryptedStore.instance;
    }

    #entries: ClipboardEntry[] = [];
    /** Entries copied while the first load is still in flight. */
    #pending: ClipboardEntry[] = [];
    #encryptionKey: Uint8Array | null = null;
    #ready = false;
    #keyPersistent = false;
    /** True when mutations happened but aren't persisted yet. */
    #dirty = false;
    /** A flush is scheduled (debounce) or currently running. */
    #savePending = false;
    #flushInFlight = false;
    #saveTimer = new Timeout();
    #initPromise: Promise<void> | null = null;

    /** Emitted after a flush persists changes to disk. */
    @signal
    entriesChanged() {}

    // ── Initialisation ───────────────────────────────────────────────────

    /**
     * Synchronous init for tests (or legacy callers). Production boot uses
     * {@link initAsync} so the heavy decrypt never blocks shell startup.
     * Skips the file load; callers testing load behaviour should use the
     * async path with a real on-disk fixture.
     *
     * @param testKey — Optional 32-byte key for testing (skips secret service).
     */
    init(testKey?: Uint8Array): void {
        if (this.#ready) return;
        this.#setupKey(testKey);
        this.#migrateLegacyJson();
        this.#migrateLegacyImages();
        this.#ready = true;
        logger.info('clipboard', `store initialised (${this.#entries.length} entries)`);
    }

    /**
     * Production async init: set up the key, load and decrypt the history
     * file, merge any entries buffered meanwhile, then mark ready. Safe to
     * call multiple times (idempotent, deduped via #initPromise).
     */
    initAsync(): Promise<void> {
        if (this.#ready) return Promise.resolve();
        if (this.#initPromise) return this.#initPromise;
        this.#initPromise = this.#doInitAsync();
        return this.#initPromise;
    }

    async #doInitAsync(): Promise<void> {
        this.#setupKey();
        this.#migrateLegacyJson();
        await this.#loadEncryptedFile();
        if (this.#pending.length > 0) {
            this.#entries = [...this.#pending, ...this.#entries];
            this.#pending = [];
            this.#dirty = true;
        }
        this.#migrateLegacyImages();
        this.#ready = true;
        logger.info('clipboard', `store initialised (${this.#entries.length} entries)`);
        if (this.#dirty) this.#save();
    }

    #setupKey(testKey?: Uint8Array): void {
        if (this.#encryptionKey) return;
        if (testKey) {
            this.#encryptionKey = testKey;
            this.#keyPersistent = true;
        } else {
            initKeyManager();
            this.#encryptionKey = getKey();
            this.#keyPersistent = isKeyPersistent();
        }
    }

    /** True after init/initAsync has completed. */
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
        return this.#entries
            .filter((e) => e.type === 'text' && e.content.toLowerCase().includes(lower))
            .slice(0, 20);
    }

    /** Find a single entry by id. */
    getEntry(id: string): ClipboardEntry | null {
        return this.#entries.find((e) => e.id === id) ?? null;
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
     *
     * Before the initial load completes, entries are buffered in #pending
     * (never lost, no throw) and merged by initAsync.
     */
    addEntry(entry: ClipboardEntry): void {
        if (!this.#ready) {
            this.#pending.push(entry);
            return;
        }

        // Move-to-front dedup — find matching content of the same type
        const dupIdx = this.#entries.findIndex(
            (e) => e.type === entry.type && e.content === entry.content
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

        // Fast-path eviction for the count cap (size eviction runs in flush)
        if (this.#entries.length > MAX_HISTORY) {
            let toEvict = this.#entries.length - MAX_HISTORY;
            for (let i = this.#entries.length - 1; i >= 0 && toEvict > 0; i--) {
                if (!this.#entries[i]!.pinned) {
                    this.#entries.splice(i, 1);
                    toEvict--;
                }
            }
        }

        this.#save();
    }

    /** Remove an entry by id. */
    deleteEntry(id: string): void {
        this.#ensureReady();
        const idx = this.#entries.findIndex((e) => e.id === id);
        if (idx === -1) return;
        this.#entries.splice(idx, 1);
        this.#save();
    }

    /** Toggle pinned state. */
    togglePin(id: string): void {
        this.#ensureReady();
        const entry = this.#entries.find((e) => e.id === id);
        if (!entry) return;
        entry.pinned = !entry.pinned;
        this.#save();
    }

    /** Remove all unpinned entries. */
    clearHistory(): void {
        this.#ensureReady();
        this.#entries = this.#entries.filter((e) => e.pinned);
        this.#save();
    }

    /**
     * Shut down: cancel any pending debounce, flush pending changes to disk,
     * then release the key. Safe to call multiple times.
     */
    async shutdown(): Promise<void> {
        if (!this.#ready) return;
        this.#saveTimer.cancel();
        await this.#flushSave();
        this.#encryptionKey = null;
        this.#entries = [];
        this.#pending = [];
        this.#dirty = false;
        this.#savePending = false;
        this.#ready = false;
    }

    /**
     * Reset internal state for testing. Clears entries and removes the
     * encrypted file so the next init() starts fresh.
     */
    testReset(): void {
        this.#saveTimer.cancel();
        this.#entries = [];
        this.#pending = [];
        this.#encryptionKey = null;
        this.#ready = false;
        this.#dirty = false;
        this.#savePending = false;
        this.#flushInFlight = false;
        this.#initPromise = null;
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

    // ── Debounced persistence ────────────────────────────────────────────

    /**
     * Mark the store dirty and schedule a flush. Bursts of mutations are
     * coalesced into a single debounced write.
     */
    #save(): void {
        this.#dirty = true;
        if (this.#savePending) return;
        this.#savePending = true;
        this.#saveTimer.start(SAVE_DEBOUNCE_MS, () => {
            void this.#flushSave();
        });
    }

    /**
     * Evict oldest unpinned entries until both caps hold, and return the
     * final serialized JSON bytes. Pinned entries are never evicted.
     */
    #evictForFlush(): Uint8Array {
        const entries = this.#entries;
        const encoder = new TextEncoder();

        // Count cap — scan from oldest (end) toward newest, evict unpinned
        if (entries.length > MAX_HISTORY) {
            let toEvict = entries.length - MAX_HISTORY;
            for (let i = entries.length - 1; i >= 0 && toEvict > 0; i--) {
                if (!entries[i]!.pinned) {
                    entries.splice(i, 1);
                    toEvict--;
                }
            }
        }

        let jsonBytes = encoder.encode(JSON.stringify({entries}));

        // Byte cap — precompute per-entry sizes so we evict without
        // re-serializing the whole array on every removal
        if (jsonBytes.length > MAX_TOTAL_BYTES) {
            const sizes = entries.map((e) => encoder.encode(JSON.stringify(e)).length + 2);
            let total = jsonBytes.length;
            for (let i = entries.length - 1; i >= 0 && total > MAX_TOTAL_BYTES; i--) {
                if (!entries[i]!.pinned) {
                    total -= sizes[i]!;
                    entries.splice(i, 1);
                    sizes.splice(i, 1);
                }
            }
            jsonBytes = encoder.encode(JSON.stringify({entries}));
        }

        if (entries.length > MAX_HISTORY || jsonBytes.length > MAX_TOTAL_BYTES) {
            logger.warn(
                'clipboard',
                `history size cap reached; kept ${entries.length} entries (${jsonBytes.length} bytes) — pinned entries retained`
            );
        }

        return jsonBytes;
    }

    /**
     * Encrypt and persist the current entries (debounced). Captures the key
     * at start so a concurrent shutdown() can't null it mid-flush.
     */
    async #flushSave(): Promise<void> {
        if (this.#flushInFlight) return;
        this.#flushInFlight = true;
        this.#saveTimer.cancel();
        try {
            const key = this.#encryptionKey;
            if (!key || !this.#keyPersistent) return;
            const jsonBytes = this.#evictForFlush();
            this.#dirty = false;
            const sealed = await encryptNative(key, jsonBytes);
            const output = serializeV3(sealed);
            GLib.mkdir_with_parents(DATA_DIR, 0o755);
            GLib.file_set_contents(HISTORY_FILE, output);
            this.#emitChanged();
            logger.debug(
                'clipboard',
                `saved ${this.#entries.length} entries (${output.length} bytes)`
            );
        } catch (e) {
            logger.error('clipboard', 'failed to save encrypted history:', e);
        } finally {
            this.#flushInFlight = false;
            this.#savePending = false;
            if (this.#dirty) {
                // Mutations arrived during the async flush — write again
                this.#savePending = true;
                this.#saveTimer.start(SAVE_DEBOUNCE_MS, () => {
                    void this.#flushSave();
                });
            }
        }
    }

    // ── Encrypted file I/O ────────────────────────────────────────────────

    async #loadEncryptedFile(): Promise<void> {
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
            const magic = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
            if (magic !== MAGIC) {
                logger.warn('clipboard', 'invalid magic in encrypted file');
                return;
            }

            // Verify version
            const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
            if (version !== VERSION) {
                // v2 GCM blobs are intentionally NOT migrated: decrypting them
                // needs the removed pure-JS AES (~2.8 MB/s — the original
                // 62 s startup freeze). Delete and start fresh.
                logger.warn(
                    'clipboard',
                    `unsupported file version ${version}, resetting history ` +
                        '(legacy encrypted blobs are not migrated)'
                );
                file.delete(null);
                return;
            }

            // v3 layout: [magic 4][version 4][nonceLen 1][nonce][macLen 1][mac][ciphertext]
            let off = 8;
            const nonceLen = data[off]!;
            off += 1;
            const nonce = data.subarray(off, off + nonceLen);
            off += nonceLen;
            const macLen = data[off]!;
            off += 1;
            const mac = data.subarray(off, off + macLen);
            off += macLen;
            const ciphertext = data.subarray(off);

            const plaintext = await decryptNative(this.#encryptionKey!, {nonce, ciphertext, mac});

            const decoder = new TextDecoder();
            const parsed: {entries: ClipboardEntry[]} = JSON.parse(decoder.decode(plaintext));
            this.#entries = parsed.entries || [];
            logger.info('clipboard', `loaded ${this.#entries.length} entries`);
        } catch (e) {
            logger.warn('clipboard', 'failed to load history, backing up and starting fresh:', e);
            // Back up the corrupted/wrong-key file before clearing
            try {
                const bak = Gio.File.new_for_path(HISTORY_FILE + '.bak');
                file.move(bak, Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch {
                file.delete(null);
            }
            this.#entries = [];
        }
    }

    // ── Legacy migration ──────────────────────────────────────────────────

    /**
     * Migrate or delete the legacy plaintext clipboard-history.json that
     * was produced by an earlier (pre-encryption) version.  Nothing reads
     * this file in the current codebase, but it could leak sensitive data.
     */
    #migrateLegacyJson(): void {
        const legacyFile = Gio.File.new_for_path(`${DATA_DIR}/clipboard-history.json`);
        if (!legacyFile.query_exists(null)) return;

        const bakPath = `${DATA_DIR}/clipboard-history.json.migrated`;
        try {
            const bak = Gio.File.new_for_path(bakPath);
            legacyFile.move(bak, Gio.FileCopyFlags.OVERWRITE, null, null);
            logger.info('clipboard', 'legacy clipboard-history.json moved to .migrated');
        } catch (e) {
            logger.warn('clipboard', 'could not archive legacy JSON:', e);
        }
    }

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

/** Serialize a SealedBlob to the v3 on-disk layout (magic/version BE). */
function serializeV3(sealed: SealedBlob): Uint8Array {
    const out = new Uint8Array(
        4 + 4 + 1 + sealed.nonce.length + 1 + sealed.mac.length + sealed.ciphertext.length
    );
    let o = 0;
    // Magic (BE — spells "SHED")
    out[o++] = (MAGIC >>> 24) & 0xff;
    out[o++] = (MAGIC >>> 16) & 0xff;
    out[o++] = (MAGIC >>> 8) & 0xff;
    out[o++] = MAGIC & 0xff;
    // Version
    out[o++] = (VERSION >>> 24) & 0xff;
    out[o++] = (VERSION >>> 16) & 0xff;
    out[o++] = (VERSION >>> 8) & 0xff;
    out[o++] = VERSION & 0xff;
    // Nonce (length-prefixed)
    out[o++] = sealed.nonce.length;
    out.set(sealed.nonce, o);
    o += sealed.nonce.length;
    // MAC (length-prefixed)
    out[o++] = sealed.mac.length;
    out.set(sealed.mac, o);
    o += sealed.mac.length;
    // Ciphertext
    out.set(sealed.ciphertext, o);
    return out;
}

// ── Convenience singleton re-exports ─────────────────────────────────────────
// These match the previous function-based API so consumers don't break.

export function initStore(): void {
    void EncryptedStore.get_default().initAsync();
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

export function shutdownStore(): Promise<void> {
    return EncryptedStore.get_default().shutdown();
}