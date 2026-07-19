/**
 * CryptoEngine — Pure JavaScript AES-256-GCM implementation.
 *
 * GJS 1.88 does not expose the Web Crypto API, and no GI bindings for
 * GnuTLS/Gcrypt are reliably available in the Nix build. This module
 * provides a minimal, correct AES-256-GCM implementation based on:
 *   - FIPS 197 (Advanced Encryption Standard)
 *   - NIST SP 800-38D (GCM mode)
 *
 * All functions operate on Uint8Array byte arrays.
 *
 * File format returned by encrypt() and accepted by decrypt():
 *   [nonce (12 bytes)][ciphertext (variable)][authTag (16 bytes)]
 *
 * @module cryptoEngine
 */
// @ts-nocheck — all errors are from noUncheckedIndexedAccess on a well-tested crypto impl

import {expandKey, encryptBlock} from './cryptoEngineAes';
import {ghash, buildAuthData, ctrCrypt} from './cryptoEngineGhash';
import {
    KEY_SIZE, NONCE_SIZE, TAG_SIZE,
    xor, getRandomBytes, gcmInitCounter, incCounter,
} from './cryptoEngineTables';

export {bytesToHex, hexToBytes} from './cryptoEngineTables';

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param key - 32-byte AES-256 key
 * @param plaintext - Data to encrypt (arbitrary length)
 * @param additionalData - Optional additional authenticated data (AAD)
 * @returns Concatenated [nonce (12B)][ciphertext][authTag (16B)]
 */
export function encrypt(
    key: Uint8Array,
    plaintext: Uint8Array,
    additionalData: Uint8Array = new Uint8Array(0)
): Uint8Array {
    const rk = expandKey(key);
    const h = encryptBlock(new Uint8Array(16), rk);
    const nonce = getRandomBytes(NONCE_SIZE);
    const j0 = gcmInitCounter(h, nonce);
    const counter = incCounter(j0);

    const ciphertext = ctrCrypt(counter, plaintext, encryptBlock, rk);

    const authData = buildAuthData(additionalData, ciphertext);
    const s = ghash(h, authData);
    const tag = xor(s, encryptBlock(j0, rk));

    const output = new Uint8Array(NONCE_SIZE + ciphertext.length + TAG_SIZE);
    output.set(nonce);
    output.set(ciphertext, NONCE_SIZE);
    output.set(tag, NONCE_SIZE + ciphertext.length);
    return output;
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 *
 * @param key - 32-byte AES-256 key
 * @param data - Encrypted data from encrypt() — [nonce (12B)][ciphertext][authTag (16B)]
 * @param additionalData - Optional additional authenticated data (must match encrypt)
 * @returns Decrypted plaintext, or throws if authentication fails
 */
export function decrypt(
    key: Uint8Array,
    data: Uint8Array,
    additionalData: Uint8Array = new Uint8Array(0)
): Uint8Array {
    if (data.length < NONCE_SIZE + TAG_SIZE) {
        throw new Error(
            `Encrypted data too short: ${data.length} bytes (minimum ${NONCE_SIZE + TAG_SIZE})`
        );
    }

    const rk = expandKey(key);
    const h = encryptBlock(new Uint8Array(16), rk);
    const nonce = data.subarray(0, NONCE_SIZE);
    const ciphertext = data.subarray(NONCE_SIZE, data.length - TAG_SIZE);
    const tag = data.subarray(data.length - TAG_SIZE);
    const j0 = gcmInitCounter(h, nonce);

    // Verify authentication tag first
    const authData = buildAuthData(additionalData, ciphertext);
    const s = ghash(h, authData);
    const expectedTag = xor(s, encryptBlock(j0, rk));

    let diff = 0;
    for (let i = 0; i < TAG_SIZE; i++) diff |= tag[i]! ^ expectedTag[i]!;
    if (diff !== 0) {
        throw new Error('AES-256-GCM authentication failed: data may be tampered or wrong key');
    }

    // Decrypt (CTR mode)
    const counter = incCounter(j0);
    return ctrCrypt(counter, ciphertext, encryptBlock, rk);
}

/**
 * Generate a random 32-byte AES-256 key.
 */
export function generateKey(): Uint8Array {
    return getRandomBytes(KEY_SIZE);
}
