// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
import {xor, padTo16, lenBlock, incCounter} from './cryptoEngineTables';

/**
 * Multiply two 128-bit values in GF(2^128) with the GCM polynomial.
 * Polynomial: x^128 + x^7 + x^2 + x + 1 (0xE1 << 120).
 */
function ghashMul(x: Uint8Array, y: Uint8Array): Uint8Array {
    const V = new Uint8Array(y);
    const Z = new Uint8Array(16);
    const R = new Uint8Array([0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    for (let i = 0; i < 128; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        if ((x[byteIdx]! >>> bitIdx) & 1) {
            for (let j = 0; j < 16; j++) Z[j]! ^= V[j]!;
        }
        if (V[15]! & 1) {
            for (let j = 15; j > 0; j--) V[j] = (V[j]! >>> 1) | ((V[j - 1]! & 1) << 7);
            V[0] = V[0]! >>> 1;
            for (let j = 0; j < 16; j++) V[j]! ^= R[j]!;
        } else {
            for (let j = 15; j > 0; j--) V[j] = (V[j]! >>> 1) | ((V[j - 1]! & 1) << 7);
            V[0] = V[0]! >>> 1;
        }
    }
    return Z;
}

/**
 * Compute GHASH over the provided data blocks.
 * @param h - Hash subkey (16 bytes, AES-256 encryption of zero block)
 * @param data - Data to authenticate (padded to 16-byte blocks)
 */
export function ghash(h: Uint8Array, data: Uint8Array): Uint8Array {
    let y = new Uint8Array(16);
    for (let i = 0; i < data.length; i += 16) {
        y = ghashMul(xor(y, data.subarray(i, i + 16)), h);
    }
    return y;
}

/**
 * Build the GCM authenticated data payload:
 * AAD || pad(AAD) || ciphertext || pad(ciphertext) || len(AAD) || len(ciphertext)
 */
export function buildAuthData(
    additionalData: Uint8Array,
    ciphertext: Uint8Array
): Uint8Array {
    const aadPadded = padTo16(additionalData);
    const ctPadded = padTo16(ciphertext);
    const authData = new Uint8Array(aadPadded.length + ctPadded.length + 16);
    authData.set(aadPadded);
    authData.set(ctPadded, aadPadded.length);
    authData.set(lenBlock(additionalData.length, ciphertext.length), aadPadded.length + ctPadded.length);
    return authData;
}

/**
 * Encrypt plaintext using AES-256-CTR (one-block-at-a-time helper).
 * Used by both encrypt() and decrypt().
 */
export function ctrCrypt(
    counter: Uint8Array,
    data: Uint8Array,
    encryptBlock: (block: Uint8Array, rk: Uint8Array) => Uint8Array,
    rk: Uint8Array
): Uint8Array {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
        const keyStream = encryptBlock(counter, rk);
        const end = Math.min(i + 16, data.length);
        for (let j = i; j < end; j++) out[j] = data[j]! ^ keyStream[j - i]!;
        counter = incCounter(counter);
    }
    return out;
}
