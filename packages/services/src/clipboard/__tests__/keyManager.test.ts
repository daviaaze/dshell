import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Secret from 'gi://Secret?version=1';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {getKey, initKeyManager, isKeyPersistent, releaseKey} from '../keyManager';

interface KeyringReply {
    collection?: boolean;
    locked?: boolean;
    session?: boolean;
    keyHex?: string;
    stored?: boolean;
    hangs?: boolean;
}

/** Replace only the external Secret Service boundary, never key policy. */
async function withKeyring(reply: KeyringReply, body: () => Promise<void>): Promise<void> {
    releaseKey();
    const original = {
        forAlias: Secret.Collection.for_alias,
        forAliasFinish: Secret.Collection.for_alias_finish,
        store: Secret.password_store,
        storeFinish: Secret.password_store_finish,
        lookupSync: Secret.password_lookup_sync,
    };
    let requestedAlias = '';
    const collection = {
        get_object_path: () =>
            `/org/freedesktop/secrets/collection/${reply.session ? 'temporary' : 'login'}`,
        get_locked: () => reply.locked ?? false,
        search: (
            _schema: Secret.Schema,
            _attributes: Record<string, string>,
            _flags: number,
            cancellable: Gio.Cancellable | null,
            callback: Gio.AsyncReadyCallback | null
        ) => {
            Gio.Task.new(null, cancellable, callback).return_boolean(true);
        },
        search_finish: () =>
            reply.keyHex === undefined
                ? []
                : [{get_secret: () => ({get_text: () => reply.keyHex})}],
    } as unknown as Secret.Collection;
    Secret.Collection.for_alias = (_service, alias, _flags, cancellable, callback) => {
        requestedAlias = alias;
        if (!reply.hangs) Gio.Task.new(null, cancellable, callback).return_boolean(true);
    };
    Secret.Collection.for_alias_finish = () => {
        if (requestedAlias === Secret.COLLECTION_SESSION) return reply.session ? collection : null;
        return reply.collection === false ? null : collection;
    };
    Secret.password_store = (
        _schema,
        _attributes,
        _collection,
        _label,
        _password,
        cancellable,
        callback
    ) => {
        Gio.Task.new(null, cancellable, callback).return_boolean(true);
    };
    Secret.password_store_finish = () => reply.stored ?? false;
    Secret.password_lookup_sync = () => {
        throw new Error('synchronous keyring access is forbidden');
    };
    try {
        await body();
    } finally {
        Secret.Collection.for_alias = original.forAlias;
        Secret.Collection.for_alias_finish = original.forAliasFinish;
        Secret.password_store = original.store;
        Secret.password_store_finish = original.storeFinish;
        Secret.password_lookup_sync = original.lookupSync;
        releaseKey();
    }
}

describe('clipboard key persistence', () => {
    it.async('a successful lookup without a persistent collection is memory-only', async () => {
        await withKeyring({collection: false}, async () => {
            await initKeyManager();
            expect(isKeyPersistent()).toBe(false);
            expect(getKey().length).toBe(32);
        });
    });

    it.async('a failed store never makes the generated key persistent', async () => {
        await withKeyring({stored: false}, async () => {
            await initKeyManager();
            expect(isKeyPersistent()).toBe(false);
        });
    });

    it.async('only a successful store enables persistence', async () => {
        await withKeyring({stored: true}, async () => {
            const initialization = initKeyManager();
            expect(isKeyPersistent()).toBe(false);
            await initialization;
            expect(isKeyPersistent()).toBe(true);
        });
    });

    it.async('a validated existing persistent key enables history reads', async () => {
        await withKeyring({keyHex: '42'.repeat(32)}, async () => {
            await initKeyManager();
            expect(isKeyPersistent()).toBe(true);
            expect(getKey()[0]).toBe(0x42);
        });
    });

    it.async('a malformed existing key is never replaced or used for history', async () => {
        await withKeyring({keyHex: 'not a key', stored: true}, async () => {
            await initKeyManager();
            expect(isKeyPersistent()).toBe(false);
            expect(getKey().length).toBe(32);
        });
    });

    it.async('locked and session collections cannot unlock persisted history', async () => {
        for (const reply of [{locked: true}, {session: true}]) {
            await withKeyring({...reply, keyHex: '42'.repeat(32)}, async () => {
                await initKeyManager();
                expect(isKeyPersistent()).toBe(false);
            });
        }
    });

    it.async('a hung keyring times out while the main loop remains responsive', async () => {
        await withKeyring({hangs: true}, async () => {
            let ticked = false;
            const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                ticked = true;
                return GLib.SOURCE_REMOVE;
            });
            try {
                await initKeyManager();
                expect(ticked).toBe(true);
                expect(isKeyPersistent()).toBe(false);
            } finally {
                if (!ticked) GLib.source_remove(timer);
            }
        });
    });
});

await run(import.meta.url);
