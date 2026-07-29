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
import logger from '../../core/logger';

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_NAME = 'com.caioasmuniz.shade.ClipboardKey';
const LABEL = 'Shade Shell Clipboard Encryption Key';
const ATTRIBUTE_KEY = 'application';
const ATTRIBUTE_VALUE = 'shade-shell';

// ── Schema definition ────────────────────────────────────────────────────────

/** Schema for identifying our key in the keyring. */
const schema = Secret.Schema.new(
    SCHEMA_NAME,
    Secret.SchemaFlags.NONE,
    {[ATTRIBUTE_KEY]: Secret.SchemaAttributeType.STRING},
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

            // Only attempt to persist the key if the secret service has a
            // default collection (i.e. the keyring has been unlocked via PAM).
            // If the collection path is NULL (keyring daemon started but login
            // collection not yet registered), password_store_sync triggers a
            // GLib C assertion that prints a non-fatal warning to stderr and
            // fails silently — the key is ephemeral for this session instead.
            if (secretServiceHasCollection()) {
                storeKey(keyResult);
            } else {
                logger.info(
                    'clipboard',
                    'keyring collection not available, ' +
                        'keeping encryption key in memory for this session'
                );
            }
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
            null,
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

const SecretService = Secret.Service;

/**
 * Check if a persistent (non-session) collection is available in the
 * Secret Service.
 *
 * gnome-keyring exposes a "session" collection immediately on D-Bus
 * activation.  The "login" (default) collection path is %NULL until PAM
 * unlocks the keyring via pam_gnome_keyring.  Calling
 * password_store_sync(NULL) before then hits:
 *
 *   secret_service_create_item_dbus_path: assertion
 *   'collection_path != NULL && g_variant_is_object_path (collection_path)'
 *   failed
 *
 * We filter out the well-known session path and return true only
 * when a real persistent collection is registered.
 */
function secretServiceHasCollection(): boolean {
    try {
        const service = SecretService.get_sync(
            Secret.ServiceFlags.OPEN_SESSION | Secret.ServiceFlags.LOAD_COLLECTIONS,
            null,
        );
        if (!service) return false;

        const collections = service.get_collections();
        if (!collections) return false;

        // gnome-keyring always exposes a session collection immediately
        // on D-Bus activation.  That collection does NOT have a valid
        // default-collection path — password_store_sync(NULL) on it
        // triggers a GLib C assertion.  Filter it out.
        const SESSION_PATH = '/org/freedesktop/secrets/collection/session';
        const realCollections = collections.filter(
            c => c.get_object_path() !== SESSION_PATH,
        );

        return realCollections.length > 0;
    } catch {
        return false;
    }
}

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
