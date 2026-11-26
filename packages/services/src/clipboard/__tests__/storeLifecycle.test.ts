import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Secret from 'gi://Secret?version=1';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {type ClipboardEntry, EncryptedStore} from '../encryptedStore';
import {loadHistoryNative} from '../nativeCrypto';

// These integration checks must never point testReset at real user history.
if (!GLib.getenv('XDG_DATA_HOME')?.startsWith(`${GLib.get_tmp_dir()}/`)) {
    throw new Error('Run clipboard lifecycle tests with an isolated temporary XDG_DATA_HOME');
}
const DIRECTORY = `${GLib.get_user_data_dir()}/shade-shell`;
const HISTORY = `${DIRECTORY}/clipboard-history.enc`;
const KEY = new Uint8Array(32).fill(0x42);

function entry(id: string): ClipboardEntry {
    return {
        id,
        type: 'text',
        content: id,
        mimeType: 'text/plain',
        timestamp: Date.now(),
        pinned: false,
    };
}

describe('clipboard store lifecycle', () => {
    it.async('shutdown drains mutations received during the current flush', async () => {
        const store = EncryptedStore.get_default();
        store.testReset();
        store.init(KEY);
        // Sixteen entries force snapshot serialization to yield to the main loop.
        for (let index = 0; index < 17; index++) store.addEntry(entry(`before-${index}`));
        const closing = store.shutdown();
        store.addEntry(entry('during-write'));
        await closing;
        const loaded = JSON.parse(
            new TextDecoder().decode(await loadHistoryNative(KEY, HISTORY))
        ) as {entries: ClipboardEntry[]};
        expect(loaded.entries[0]?.content).toBe('during-write');
        expect(loaded.entries.length).toBe(18);
        expect(store.ready).toBe(false);
        store.testReset();
    });

    it.async('shutdown also drains entries buffered before initialization starts', async () => {
        const store = EncryptedStore.get_default();
        store.testReset();
        const starting = store.initAsync(KEY);
        store.addEntry(entry('before-load'));
        const closing = store.shutdown();
        await starting;
        await closing;
        const loaded = JSON.parse(
            new TextDecoder().decode(await loadHistoryNative(KEY, HISTORY))
        ) as {entries: ClipboardEntry[]};
        expect(loaded.entries[0]?.content).toBe('before-load');
        store.testReset();
    });

    it.async('an unreadable file is never renamed, deleted, or overwritten later', async () => {
        const store = EncryptedStore.get_default();
        store.testReset();
        GLib.mkdir_with_parents(DIRECTORY, 0o700);
        const original = new TextEncoder().encode('preserve this unreadable history');
        GLib.file_set_contents(HISTORY, original);
        await store.initAsync(KEY);
        store.addEntry(entry('memory-only'));
        await store.shutdown();
        const [, actual] = Gio.File.new_for_path(HISTORY).load_contents(null);
        expect(Array.from(actual)).toEqual(Array.from(original));
        expect(Gio.File.new_for_path(`${HISTORY}.bak`).query_exists(null)).toBe(false);
        store.testReset();
    });

    it.async('ephemeral-key sessions do not even migrate plaintext leftovers', async () => {
        const store = EncryptedStore.get_default();
        store.testReset();
        GLib.mkdir_with_parents(DIRECTORY, 0o700);
        GLib.file_set_contents(HISTORY, new TextEncoder().encode('old ciphertext'));
        const legacy = `${DIRECTORY}/clipboard-history.json.migrated`;
        GLib.file_set_contents(
            legacy,
            new TextEncoder().encode(JSON.stringify({entries: [entry('old plaintext')]}))
        );
        const originalForAlias = Secret.Collection.for_alias;
        const originalFinish = Secret.Collection.for_alias_finish;
        Secret.Collection.for_alias = (_service, _alias, _flags, cancellable, callback) => {
            Gio.Task.new(null, cancellable, callback).return_boolean(true);
        };
        Secret.Collection.for_alias_finish = () => null;
        try {
            await store.initAsync();
            store.addEntry(entry('not for disk'));
            await store.shutdown();
            const [, actual] = Gio.File.new_for_path(HISTORY).load_contents(null);
            expect(new TextDecoder().decode(actual)).toBe('old ciphertext');
            expect(Gio.File.new_for_path(legacy).query_exists(null)).toBe(true);
            expect(Gio.File.new_for_path(`${HISTORY}.bak`).query_exists(null)).toBe(false);
        } finally {
            Secret.Collection.for_alias = originalForAlias;
            Secret.Collection.for_alias_finish = originalFinish;
            await store.shutdown();
            store.testReset();
            Gio.File.new_for_path(legacy).delete(null);
        }
    });
});

await run(import.meta.url);
