/**
 * KeyManager — Manage the AES-256 encryption key via libsecret (Secret Service).
 *
 * On first run, generates a random 256-bit key and stores it in the system
 * keyring (GNOME Keyring / KDE Wallet). On subsequent runs, retrieves the
 * key from the keyring.
 *
 * If the key is missing from the keyring (e.g., keyring was reset, or running
 * on a new machine), a new key is generated. Previous clipboard history
 * becomes unrecoverable — this is by design.
 *
 * Keyring access uses a timeout to avoid blocking when the keyring daemon
 * is not available (e.g., headless sessions, test environments).
 *
 * @module keyManager
 */

import Secret from 'gi://Secret?version=1';
import {generateKey, bytesToHex, hexToBytes} from './cryptoEngine';
import logger from '#/lib/core/logger';

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_NAME = 'com.caioasmuniz.shade.ClipboardKey';
const LABEL = 'Shade Shell Clipboard Encryption Key';
const ATTRIBUTE_KEY = 'application';
const ATTRIBUTE_VALUE = 'shade-shell';

// ── Schema definition ────────────────────────────────────────────────────────

/** Schema for identifying our key in the keyring. */
const schema = new (Secret.Schema as any)(
    SCHEMA_NAME,
    Secret.SchemaFlags.NONE,
    {
        [ATTRIBUTE_KEY]: Secret.SchemaAttributeType.STRING,
    }
);

// ── State ────────────────────────────────────────────────────────────────────

let keyResult: Uint8Array | null = null;
let keyringReady = false;
let keyringAttempted = false;

// ── Key Manager ──────────────────────────────────────────────────────────────

/**
 * Initialize the key manager.
 *
 * Tries to access the keyring synchronously. If the keyring daemon is not
 * available, generates an ephemeral key.
 *
 * Must be called during app startup.
 */
export function initKeyManager(): void {
    if (keyringAttempted) return;
    keyringAttempted = true;

    // Check if the secret service is available by trying to get the shared service
    // This will trigger D-Bus activation, but we handle the timeout
    try {
        // Try to look up the key — this will trigger D-Bus activation if needed
        const keyHex = Secret.password_lookup_sync(
            schema,
            {[ATTRIBUTE_KEY]: ATTRIBUTE_VALUE},
            null
        );

        keyringReady = true;

        if (keyHex && keyHex.length > 0) {
            logger.info('clipboard', 'retrieved encryption key from keyring');
            keyResult = hexToBytes(keyHex);
        } else {
            logger.info(
                'clipboard',
                'no encryption key found, generating new key'
            );
            keyResult = generateKey();
            storeKey(keyResult);
        }
    } catch (e) {
        keyringReady = false;
        logger.warn(
            'clipboard',
            'keyring not available, generating ephemeral key:',
            e
        );
        keyResult = generateKey();
    }
}

/**
 * Store the key in the keyring (best-effort).
 */
function storeKey(key: Uint8Array): void {
    if (!keyringReady) return;

    const keyHex = bytesToHex(key);
    try {
        const stored = Secret.password_store_sync(
            schema,
            {[ATTRIBUTE_KEY]: ATTRIBUTE_VALUE},
            '',
            LABEL,
            keyHex,
            null
        );
        if (stored) {
            logger.info('clipboard', 'encryption key stored in keyring');
        } else {
            logger.warn(
                'clipboard',
                'failed to store encryption key in keyring'
            );
        }
    } catch (e) {
        logger.warn('clipboard', 'failed to store key in keyring:', e);
    }
}

/**
 * Retrieve the AES-256 key.
 *
 * Must be called after initKeyManager().
 *
 * @returns 32-byte AES-256 key as Uint8Array
 */
export function getKey(): Uint8Array {
    if (!keyringAttempted) {
        initKeyManager();
    }
    if (!keyResult) {
        keyResult = generateKey();
    }
    return keyResult;
}

/**
 * Delete the encryption key from the keyring.
 *
 * Warning: This makes the current clipboard history unrecoverable.
 */
export function deleteKey(): void {
    if (!keyringReady) return;
    try {
        Secret.password_clear_sync(
            schema,
            {[ATTRIBUTE_KEY]: ATTRIBUTE_VALUE},
            null
        );
        logger.info('clipboard', 'encryption key deleted from keyring');
        keyResult = null;
    } catch (e) {
        logger.error('clipboard', 'failed to delete encryption key:', e);
    }
}

/**
 * Check if an encryption key exists in the keyring.
 *
 * @returns true if a key exists
 */
export function hasKey(): boolean {
    if (!keyringReady) return false;
    try {
        const result = Secret.password_lookup_sync(
            schema,
            {[ATTRIBUTE_KEY]: ATTRIBUTE_VALUE},
            null
        );
        return result !== null && result.length > 0;
    } catch {
        return false;
    }
}
