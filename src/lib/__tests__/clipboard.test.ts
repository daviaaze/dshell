/**
 * Tests for EncryptedStore — clipboard history store.
 *
 * Run: gjs -m build/test/clipboard.test.js
 * (built via esbuild by the 'test' script in package.json)
 */

import {EncryptedStore} from '#/lib/services/clipboard/encryptedStore';
import type {ClipboardEntry} from '#/lib/services/clipboard/encryptedStore';
import {describe, it, expect, run} from '../__tests__/test-runner';

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

    it('entriesChanged signal fires on addEntry', () => {
        const store = freshStore();
        let signalFired = false;
        (store as any).connect('entries-changed', () => {
            signalFired = true;
        });
        store.addEntry({
            id: 'signal-test',
            type: 'text',
            content: 'signal check',
            mimeType: 'text/plain',
            timestamp: 1000,
            pinned: false,
        });
        expect(signalFired).toBe(true);
    });
});

await run(import.meta.url);
