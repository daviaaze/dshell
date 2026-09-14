/**
 * Tests for EncryptedStore — clipboard history store.
 *
 * Run: gjs -m build/test/clipboard.test.js
 * (built via esbuild by the 'test' script in package.json)
 */

import type {ClipboardEntry} from '../clipboard/encryptedStore';
import {EncryptedStore} from '../clipboard/encryptedStore';
import {decryptNative, encryptNative} from '../clipboard/nativeCrypto';
import {describe, expect, it, run} from './test-runner';

/** Valid 32-byte AES-256 key for testing. */
const TEST_KEY = new Uint8Array(32).fill(0x42);

/**
 * Reset the singleton and init with test key, giving each test a clean
 * slate (no file on disk, no cached state).
 */
function freshStore(): EncryptedStore {
    const store = EncryptedStore.get_default();
    store.testReset();
    store.init(TEST_KEY);
    return store;
}

describe('EncryptedStore', () => {
    it('is a singleton', () => {
        const a = EncryptedStore.get_default();
        const b = EncryptedStore.get_default();
        expect(a).toBe(b);
    });

    it('starts with ready = false before init', () => {
        const store = EncryptedStore.get_default();
        store.testReset();
        expect(store.ready).toBe(false);
    });

    it('init with test key makes it ready', () => {
        const store = freshStore();
        expect(store.ready).toBe(true);
    });

    it('starts with empty entries', () => {
        const store = freshStore();
        expect(store.getAllEntries().length).toBe(0);
    });

    it('addEntry creates a new entry at front', () => {
        const store = freshStore();
        const entry: ClipboardEntry = {
            id: 'test-1',
            type: 'text',
            content: 'hello world',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        };
        store.addEntry(entry);
        const entries = store.getAllEntries();
        expect(entries.length).toBe(1);
        expect(entries[0]!.id).toBe('test-1');
        expect(entries[0]!.content).toBe('hello world');
    });

    it('addEntry with same content moves to front (dedup)', () => {
        const store = freshStore();
        store.addEntry({
            id: 'first',
            type: 'text',
            content: 'first entry',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        store.addEntry({
            id: 'second',
            type: 'text',
            content: 'second entry',
            mimeType: 'text/plain',
            timestamp: 2000,
            pinned: false,
        });

        // Re-add the same content as 'first entry' — should move to front
        store.addEntry({
            id: 'first-dup',
            type: 'text',
            content: 'first entry',
            mimeType: 'text/plain',
            timestamp: 3000,
            pinned: false,
        });

        const entries = store.getAllEntries();
        // Still 2 entries (not 3)
        expect(entries.length).toBe(2);
        // 'first entry' moved to front with updated timestamp
        expect(entries[0]!.id).toBe('first');
        expect(entries[0]!.timestamp).toBe(3000);
        expect(entries[1]!.id).toBe('second');
    });

    it('deleteEntry removes by id', () => {
        const store = freshStore();
        store.addEntry({
            id: 'delete-me',
            type: 'text',
            content: 'will be deleted',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        expect(store.getAllEntries().length).toBe(1);
        store.deleteEntry('delete-me');
        expect(store.getAllEntries().length).toBe(0);
    });

    it('searchEntries returns text matches', () => {
        const store = freshStore();
        store.addEntry({
            id: 's1',
            type: 'text',
            content: 'hello world',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        store.addEntry({
            id: 's2',
            type: 'text',
            content: 'goodbye world',
            mimeType: 'text/plain',
            timestamp: 2000,
            pinned: false,
        });
        const results = store.searchEntries('hello');
        expect(results.length).toBe(1);
        expect(results[0]!.content).toBe('hello world');
    });

    it('togglePin toggles the pinned flag', () => {
        const store = freshStore();
        store.addEntry({
            id: 'pin-test',
            type: 'text',
            content: 'toggle me',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        expect(store.getEntry('pin-test')!.pinned).toBe(false);

        store.togglePin('pin-test');
        expect(store.getEntry('pin-test')!.pinned).toBe(true);

        store.togglePin('pin-test');
        expect(store.getEntry('pin-test')!.pinned).toBe(false);
    });

    it('clearHistory removes unpinned entries only', () => {
        const store = freshStore();
        // Unpinned entry
        store.addEntry({
            id: 'unpin-me',
            type: 'text',
            content: 'will be cleared',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        // Pinned entry
        store.addEntry({
            id: 'pin-me',
            type: 'text',
            content: 'stays',
            mimeType: 'text/plain',
            timestamp: 2000,
            pinned: true,
        });
        expect(store.getAllEntries().length).toBe(2);

        store.clearHistory();
        const remaining = store.getAllEntries();
        expect(remaining.length).toBe(1);
        expect(remaining[0]!.id).toBe('pin-me');
        expect(remaining[0]!.pinned).toBe(true);
    });

    it('caps history at MAX_HISTORY=500 keeping newest + pinned', () => {
        const store = freshStore();
        // Pin an early entry — it must survive count eviction.
        store.addEntry({
            id: 'pinned-old',
            type: 'text',
            content: 'pinned survivor',
            mimeType: 'text/plain',
            timestamp: 1,
            pinned: true,
        });
        // Add 600 distinct text entries (601 total with the pinned one).
        for (let i = 0; i < 600; i++) {
            store.addEntry({
                id: `entry-${i}`,
                type: 'text',
                content: `content-${i}`,
                mimeType: 'text/plain',
                timestamp: 1000 + i,
                pinned: false,
            });
        }
        const entries = store.getAllEntries();
        expect(entries.length).toBe(500);
        // Newest entry is at the front.
        expect(entries[0]!.content).toBe('content-599');
        // Pinned entry survived eviction.
        expect(store.getEntry('pinned-old')!.pinned).toBe(true);
        // Oldest unpinned entries were evicted.
        expect(store.getEntry('content-0')).toBeNull();
    });

    it.async('entriesChanged signal fires when a flush persists', async () => {
        const store = freshStore();
        let signalFired = false;
        (store as unknown as {connect(s: string, cb: () => void): number}).connect(
            'entries-changed',
            () => {
                signalFired = true;
            }
        );
        store.addEntry({
            id: 'signal-test',
            type: 'text',
            content: 'signal check',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        // Debounce never fires without a main loop in tests — flush via
        // shutdown, which is the same write path.
        await store.shutdown();
        expect(signalFired).toBe(true);
    });
});

describe('NativeCrypto', () => {
    it.async('round-trips plaintext through AES-256-CTR + HMAC-SHA256', async () => {
        const key = new Uint8Array(32).fill(0x42);
        const plaintext = new TextEncoder().encode('native crypto roundtrip');
        const sealed = await encryptNative(key, plaintext);
        expect(sealed.nonce.length).toBe(16);
        expect(sealed.mac.length).toBe(32);
        const decrypted = await decryptNative(key, sealed);
        expect(new TextDecoder().decode(decrypted)).toBe('native crypto roundtrip');
    });

    it.async('rejects tampered ciphertext (MAC mismatch)', async () => {
        const key = new Uint8Array(32).fill(0x42);
        const plaintext = new TextEncoder().encode('tamper me');
        const sealed = await encryptNative(key, plaintext);
        // Flip one ciphertext byte — decrypt must fail auth before decrypting.
        sealed.ciphertext[0] = (sealed.ciphertext[0]! ^ 0xff) & 0xff;
        let threw = false;
        try {
            await decryptNative(key, sealed);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });
});

await run(import.meta.url);
