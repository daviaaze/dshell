/**
 * Clipboard history with persistent-key-only disk access.
 *
 * Encryption, migration and durable private file I/O run in the crypto worker.
 * JSON snapshots are encoded incrementally, yielding between batches. Copies
 * received during initialization are merged, and shutdown drains the current
 * write plus every newer dirty snapshot before releasing the key.
 *
 * An unavailable keyring or unreadable existing file is memory-only for this
 * session: neither the encrypted file nor plaintext migration sources move.
 */
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {Timeout} from '@shade/core/timeout';
import logger from '@shade/core/logger';
import {Object, register, signal} from 'gnim/gobject';
import {loadHistoryNative, writeHistoryNative} from './nativeCrypto';
import {getKey, initKeyManager, isKeyPersistent, releaseKey} from './keyManager';

export interface ClipboardEntry {
    id: string;
    type: 'text' | 'image';
    /** Text, or base64-encoded image bytes. */
    content: string;
    mimeType: string;
    timestamp: number;
    pinned: boolean;
}

const HISTORY_FILE = `${GLib.get_user_data_dir()}/shade-shell/clipboard-history.enc`;
const MAX_HISTORY = 500;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 1500;

@register
export class EncryptedStore extends Object {
    private static instance: EncryptedStore;

    static get_default() {
        if (!EncryptedStore.instance) EncryptedStore.instance = new EncryptedStore();
        return EncryptedStore.instance;
    }

    #entries: ClipboardEntry[] = [];
    #pending: ClipboardEntry[] = [];
    #encryptionKey: Uint8Array | null = null;
    #ready = false;
    #keyPersistent = false;
    #canPersist = false;
    #dirty = false;
    #savePending = false;
    #revision = 0;
    #saveTimer = new Timeout();
    #flushPromise: Promise<void> | null = null;
    #initPromise: Promise<void> | null = null;
    #shutdownPromise: Promise<void> | null = null;
    #closing = false;

    /** Emitted after persistence, or an in-memory-only mutation. */
    @signal
    entriesChanged() {}

    /** Synchronous keyed setup for callers not testing disk loading. */
    init(testKey?: Uint8Array): void {
        if (this.#closing) throw new Error('clipboard store is shutting down');
        if (this.#ready) return;
        if (!testKey) {
            void this.initAsync().catch((error) =>
                logger.error('clipboard', 'failed to initialize history:', error)
            );
            return;
        }
        if (testKey.length !== 32) throw new Error('clipboard key must be 32 bytes');
        this.#encryptionKey = testKey.slice();
        this.#keyPersistent = true;
        this.#canPersist = true;
        this.#ready = true;
    }

    /** The optional explicit key also permits isolated on-disk fixture tests. */
    initAsync(testKey?: Uint8Array): Promise<void> {
        if (this.#shutdownPromise) return this.#shutdownPromise.then(() => this.initAsync(testKey));
        if (this.#ready) return Promise.resolve();
        this.#initPromise ??= this.#doInitAsync(testKey);
        return this.#initPromise;
    }

    async #doInitAsync(testKey?: Uint8Array): Promise<void> {
        if (testKey) {
            if (testKey.length !== 32) throw new Error('clipboard key must be 32 bytes');
            this.#encryptionKey = testKey.slice();
            this.#keyPersistent = true;
        } else {
            await initKeyManager();
            this.#encryptionKey = getKey();
            this.#keyPersistent = isKeyPersistent();
        }
        this.#canPersist = this.#keyPersistent;
        if (this.#keyPersistent) {
            try {
                const contents = await loadHistoryNative(this.#encryptionKey, HISTORY_FILE);
                const parsed: {entries: ClipboardEntry[]} = JSON.parse(
                    new TextDecoder().decode(contents)
                );
                if (!Array.isArray(parsed.entries))
                    throw new Error('invalid clipboard worker response');
                this.#entries = parsed.entries;
            } catch (error) {
                // A wrong key, malformed legacy blob or unavailable helper must
                // not cause rotation, deletion, migration or later overwrites.
                this.#canPersist = false;
                logger.warn(
                    'clipboard',
                    'history is unreadable; preserving files and using memory only:',
                    error
                );
            }
        }
        const hadPending = this.#pending.length > 0;
        for (const entry of this.#pending) {
            const duplicate = this.#entries.findIndex(
                (value) => value.type === entry.type && value.content === entry.content
            );
            if (duplicate !== -1) {
                const existing = this.#entries.splice(duplicate, 1)[0]!;
                entry.pinned ||= existing.pinned;
            }
            this.#entries.unshift(entry);
        }
        this.#pending = [];
        this.#ready = true;
        logger.info('clipboard', `store initialized (${this.#entries.length} entries)`);
        if (hadPending) this.#save();
    }

    get ready(): boolean {
        return this.#ready;
    }

    getAllEntries(): ClipboardEntry[] {
        return [...this.#entries];
    }

    searchEntries(query: string): ClipboardEntry[] {
        if (!query) return this.#entries.slice(0, 20);
        const lower = query.toLowerCase();
        return this.#entries
            .filter((entry) => entry.type === 'text' && entry.content.toLowerCase().includes(lower))
            .slice(0, 20);
    }

    getEntry(id: string): ClipboardEntry | null {
        return this.#entries.find((entry) => entry.id === id) ?? null;
    }

    addEntry(entry: ClipboardEntry): void {
        if (!this.#ready) {
            this.#pending.push(entry);
            if (this.#pending.length > MAX_HISTORY) this.#pending.shift();
            return;
        }
        const duplicate = this.#entries.findIndex(
            (value) => value.type === entry.type && value.content === entry.content
        );
        if (duplicate !== -1) {
            const existing = this.#entries.splice(duplicate, 1)[0]!;
            existing.timestamp = entry.timestamp;
            this.#entries.unshift(existing);
        } else {
            this.#entries.unshift(entry);
        }
        let excess = this.#entries.length - MAX_HISTORY;
        for (let index = this.#entries.length - 1; index >= 0 && excess > 0; index--) {
            if (!this.#entries[index]!.pinned) {
                this.#entries.splice(index, 1);
                excess--;
            }
        }
        this.#save();
    }

    deleteEntry(id: string): void {
        this.#ensureReady();
        const index = this.#entries.findIndex((entry) => entry.id === id);
        if (index === -1) return;
        this.#entries.splice(index, 1);
        this.#save();
    }

    togglePin(id: string): void {
        this.#ensureReady();
        const entry = this.#entries.find((value) => value.id === id);
        if (!entry) return;
        entry.pinned = !entry.pinned;
        this.#save();
    }

    clearHistory(): void {
        this.#ensureReady();
        this.#entries = this.#entries.filter((entry) => entry.pinned);
        this.#save();
    }

    shutdown(): Promise<void> {
        this.#shutdownPromise ??= this.#doShutdown().finally(() => {
            this.#closing = false;
            this.#shutdownPromise = null;
        });
        return this.#shutdownPromise;
    }

    async #doShutdown(): Promise<void> {
        this.#closing = true;
        this.#saveTimer.cancel();
        if (!this.#ready && this.#pending.length > 0 && !this.#initPromise) {
            this.#initPromise = this.#doInitAsync();
        }
        if (this.#initPromise) await this.#initPromise;
        if (this.#flushPromise) await this.#flushPromise;
        while (this.#dirty) await this.#flushSave();
        this.#encryptionKey?.fill(0);
        releaseKey();
        this.#encryptionKey = null;
        this.#entries = [];
        this.#pending = [];
        this.#dirty = false;
        this.#savePending = false;
        this.#ready = false;
        this.#keyPersistent = false;
        this.#canPersist = false;
        this.#initPromise = null;
    }

    /** Existing isolated-test reset API; never races an asynchronous operation. */
    testReset(): void {
        if (this.#flushPromise || this.#shutdownPromise || (this.#initPromise && !this.#ready)) {
            throw new Error('await clipboard initialization/shutdown before resetting');
        }
        this.#saveTimer.cancel();
        this.#encryptionKey?.fill(0);
        releaseKey();
        this.#entries = [];
        this.#pending = [];
        this.#encryptionKey = null;
        this.#ready = false;
        this.#keyPersistent = false;
        this.#canPersist = false;
        this.#dirty = false;
        this.#savePending = false;
        this.#initPromise = null;
        try {
            Gio.File.new_for_path(HISTORY_FILE).delete(null);
        } catch (error) {
            if (
                !(error instanceof GLib.Error) ||
                !error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)
            )
                throw error;
        }
    }

    #ensureReady(): void {
        if (!this.#ready)
            throw new Error('EncryptedStore not initialized — call initAsync() first');
    }

    #save(): void {
        this.#revision++;
        if (!this.#encryptionKey || !this.#keyPersistent || !this.#canPersist) {
            this.#dirty = false;
            this.entriesChanged();
            return;
        }
        this.#dirty = true;
        if (this.#closing || this.#savePending) return;
        this.#scheduleSave();
    }

    #scheduleSave(): void {
        this.#savePending = true;
        this.#saveTimer.start(SAVE_DEBOUNCE_MS, () => {
            void this.#flushSave().catch((error) =>
                logger.error('clipboard', 'failed to save encrypted history:', error)
            );
        });
    }

    async #snapshotForFlush(revision: number): Promise<Uint8Array> {
        const entries = this.#entries.map((entry) => ({...entry}));
        const encoder = new TextEncoder();
        const prefix = encoder.encode('{"entries":[');
        const suffix = encoder.encode(']}');
        const chunks: Uint8Array[] = [];
        let total = prefix.length + suffix.length;
        for (const [index, entry] of entries.entries()) {
            const chunk = encoder.encode(JSON.stringify(entry));
            chunks.push(chunk);
            total += chunk.length + (index > 0 ? 1 : 0);
            if (index % 16 === 15 || chunk.length > 1024 * 1024) {
                const {promise, resolve} = Promise.withResolvers<void>();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
                await promise;
            }
        }
        for (
            let index = entries.length - 1;
            index >= 0 && (entries.length > MAX_HISTORY || total > MAX_TOTAL_BYTES);
            index--
        ) {
            if (!entries[index]!.pinned) {
                total -= chunks[index]!.length + (entries.length > 1 ? 1 : 0);
                entries.splice(index, 1);
                chunks.splice(index, 1);
            }
        }
        if (entries.length > MAX_HISTORY || total > MAX_TOTAL_BYTES) {
            throw new Error('pinned clipboard entries exceed the storage limit');
        }
        if (revision === this.#revision) {
            const retained = new Set(entries.map((entry) => entry.id));
            this.#entries = this.#entries.filter((entry) => retained.has(entry.id));
        }
        const output = new Uint8Array(total);
        output.set(prefix);
        let offset = prefix.length;
        for (const [index, chunk] of chunks.entries()) {
            if (index > 0) output[offset++] = 0x2c;
            output.set(chunk, offset);
            offset += chunk.length;
        }
        output.set(suffix, offset);
        return output;
    }

    #flushSave(): Promise<void> {
        if (this.#flushPromise) return this.#flushPromise;
        this.#saveTimer.cancel();
        if (!this.#dirty || !this.#encryptionKey || !this.#keyPersistent || !this.#canPersist) {
            this.#dirty = false;
            this.#savePending = false;
            return Promise.resolve();
        }
        this.#savePending = true;
        const key = this.#encryptionKey;
        const revision = this.#revision;
        this.#dirty = false;
        let succeeded = false;
        this.#flushPromise = (async () => {
            const plaintext = await this.#snapshotForFlush(revision);
            try {
                await writeHistoryNative(key, HISTORY_FILE, plaintext);
            } finally {
                plaintext.fill(0);
            }
            succeeded = true;
            this.entriesChanged();
        })()
            .catch((error) => {
                this.#dirty = true;
                throw error;
            })
            .finally(() => {
                this.#flushPromise = null;
                this.#savePending = false;
                // Failures remain dirty for an explicit retry/new mutation, not a
                // perpetual timer. Shutdown propagates the error without clearing.
                if (succeeded && this.#dirty && !this.#closing) this.#scheduleSave();
            });
        return this.#flushPromise;
    }
}

export function initStore(): void {
    void EncryptedStore.get_default()
        .initAsync()
        .catch((error) => logger.error('clipboard', 'failed to initialize history:', error));
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
