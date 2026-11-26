/**
 * Clipboard key lifecycle. Only a validated key from the persistent default
 * collection, or a successfully stored new key, may unlock on-disk history.
 * Every Secret Service operation is asynchronous, cancellable and bounded.
 * An unavailable/locked/session-only keyring leaves history in memory only.
 */
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Secret from 'gi://Secret?version=1';
import logger from '@shade/core/logger';
import {bytesToHex, generateKeyNative, hexToBytes} from './nativeCrypto';

const schema = Secret.Schema.new('com.caioasmuniz.shade.ClipboardKey', Secret.SchemaFlags.NONE, {
    application: Secret.SchemaAttributeType.STRING,
});
const attributes = {application: 'shade-shell'};
const KEYRING_TIMEOUT_MS = 2000;
let keyResult: Uint8Array | null = null;
let keyStored = false;
let initPromise: Promise<void> | null = null;

function keyringOperation<T>(
    start: (cancellable: Gio.Cancellable, callback: Gio.AsyncReadyCallback) => void,
    finish: (result: Gio.AsyncResult) => T
): Promise<T> {
    const {promise, resolve, reject} = Promise.withResolvers<T>();
    const cancellable = new Gio.Cancellable();
    let settled = false;
    let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEYRING_TIMEOUT_MS, () => {
        timer = 0;
        settled = true;
        cancellable.cancel();
        reject(new Error('clipboard keyring operation timed out'));
        return GLib.SOURCE_REMOVE;
    });
    try {
        start(cancellable, (_, result) => {
            try {
                // Finish even a cancelled operation to release its result.
                const value = finish(result);
                if (!settled) resolve(value);
            } catch (error) {
                if (!settled) reject(error);
            } finally {
                settled = true;
                if (timer) GLib.source_remove(timer);
                timer = 0;
            }
        });
    } catch (error) {
        settled = true;
        if (timer) GLib.source_remove(timer);
        timer = 0;
        reject(error);
    }
    return promise;
}

async function initializeKey(): Promise<void> {
    keyStored = false;
    try {
        const collection = await keyringOperation(
            (cancellable, callback) =>
                Secret.Collection.for_alias(
                    null,
                    Secret.COLLECTION_DEFAULT,
                    Secret.CollectionFlags.NONE,
                    cancellable,
                    callback
                ),
            (result) => Secret.Collection.for_alias_finish(result)
        );
        const path = collection?.get_object_path();
        if (!collection || !path || collection.get_locked()) {
            throw new Error('no unlocked persistent default keyring collection');
        }
        const sessionCollection = await keyringOperation(
            (cancellable, callback) =>
                Secret.Collection.for_alias(
                    null,
                    Secret.COLLECTION_SESSION,
                    Secret.CollectionFlags.NONE,
                    cancellable,
                    callback
                ),
            (result) => Secret.Collection.for_alias_finish(result)
        );
        if (sessionCollection?.get_object_path() === path) {
            throw new Error('default keyring collection is session-only');
        }
        const items = await keyringOperation(
            (cancellable, callback) =>
                collection.search(
                    schema,
                    attributes,
                    Secret.SearchFlags.LOAD_SECRETS,
                    cancellable,
                    callback
                ),
            (result) => collection.search_finish(result)
        );
        if (items.length > 0) {
            const keyHex = items[0]!.get_secret()?.get_text();
            if (!keyHex) throw new Error('keyring clipboard key is not readable');
            keyResult = hexToBytes(keyHex);
            keyStored = true;
            return;
        }
        keyResult = generateKeyNative();
        const stored = await keyringOperation(
            (cancellable, callback) =>
                Secret.password_store(
                    schema,
                    attributes,
                    path,
                    'Shade Shell Clipboard Encryption Key',
                    bytesToHex(keyResult!),
                    cancellable,
                    callback
                ),
            (result) => Secret.password_store_finish(result)
        );
        keyStored = stored;
        if (!stored)
            logger.warn('clipboard', 'keyring did not store the key; history is memory-only');
    } catch (error) {
        logger.warn(
            'clipboard',
            'persistent key unavailable; leaving on-disk history untouched:',
            error
        );
    }
    if (!keyResult) keyResult = generateKeyNative();
}

export function initKeyManager(): Promise<void> {
    initPromise ??= initializeKey();
    return initPromise;
}

/** Call only after awaiting initKeyManager(). */
export function getKey(): Uint8Array {
    if (!keyResult) throw new Error('clipboard key manager is not initialized');
    return keyResult;
}

export function isKeyPersistent(): boolean {
    return keyStored;
}

/** Called after the store has drained all in-flight crypto and disk writes. */
export function releaseKey(): void {
    keyResult?.fill(0);
    keyResult = null;
    keyStored = false;
    initPromise = null;
}
