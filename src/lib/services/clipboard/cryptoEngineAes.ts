// @ts-nocheck — noUncheckedIndexedAccess on well-tested crypto impl

import {KEY_SIZE, SBOX, xtime} from './cryptoEngineTables';

/**
 * Expand a 32-byte AES-256 key into 15 round keys (240 bytes).
 */
export function expandKey(key: Uint8Array): Uint8Array {
    if (key.length !== KEY_SIZE) {
        throw new Error(`AES-256 requires ${KEY_SIZE}-byte key, got ${key.length}`);
    }

    const w = new Uint32Array(60);
    const Nk = 8;
    const Nb = 4;
    const Nr = 14;

    for (let i = 0; i < Nk; i++) {
        w[i] = ((key[i * 4]! << 24) | (key[i * 4 + 1]! << 16) | (key[i * 4 + 2]! << 8) | key[i * 4 + 3]!) >>> 0;
    }

    for (let i = Nk; i < Nb * (Nr + 1); i++) {
        let temp = w[i - 1]!;
        if (i % Nk === 0) {
            temp = ((temp << 8) | (temp >>> 24)) >>> 0;
            temp = (SBOX[(temp >>> 24) & 0xff]! << 24) |
                   (SBOX[(temp >>> 16) & 0xff]! << 16) |
                   (SBOX[(temp >>> 8) & 0xff]! << 8) |
                   SBOX[temp & 0xff]!;
            temp ^= (RCON[Math.floor(i / Nk) - 1]! << 24);
            temp >>>= 0;
        } else if (i % Nk === 4) {
            temp = (SBOX[(temp >>> 24) & 0xff]! << 24) |
                   (SBOX[(temp >>> 16) & 0xff]! << 16) |
                   (SBOX[(temp >>> 8) & 0xff]! << 8) |
                   SBOX[temp & 0xff]!;
        }
        w[i] = (w[i - Nk]! ^ temp) >>> 0;
    }

    const rk = new Uint8Array(Nb * (Nr + 1) * 4);
    for (let i = 0; i < w.length; i++) {
        rk[i * 4] = (w[i]! >>> 24) & 0xff;
        rk[i * 4 + 1] = (w[i]! >>> 16) & 0xff;
        rk[i * 4 + 2] = (w[i]! >>> 8) & 0xff;
        rk[i * 4 + 3] = w[i]! & 0xff;
    }
    return rk;
}

// RCON used in expandKey
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

/**
 * Encrypt a single 16-byte block with AES-256.
 */
export function encryptBlock(block: Uint8Array, rk: Uint8Array): Uint8Array {
    const state = new Uint8Array(16);
    state.set(block);

    const Nb = 4;
    const Nr = 14;

    for (let i = 0; i < 16; i++) state[i]! ^= rk[i]!;

    for (let round = 1; round <= Nr; round++) {
        for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]!]!;

        const tmp1 = state[1]!;
        state[1] = state[5]!;
        state[5] = state[9]!;
        state[9] = state[13]!;
        state[13] = tmp1;

        const tmp2a = state[2]!;
        const tmp2b = state[6]!;
        state[2] = state[10]!;
        state[6] = state[14]!;
        state[10] = tmp2a;
        state[14] = tmp2b;

        const tmp3 = state[3]!;
        state[3] = state[15]!;
        state[15] = state[11]!;
        state[11] = state[7]!;
        state[7] = tmp3;

        if (round < Nr) {
            for (let c = 0; c < Nb; c++) {
                const i = c * 4;
                const a0 = state[i]!;
                const a1 = state[i + 1]!;
                const a2 = state[i + 2]!;
                const a3 = state[i + 3]!;
                state[i] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
                state[i + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
                state[i + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
                state[i + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
            }
        }

        const rkOff = round * 16;
        for (let i = 0; i < 16; i++) state[i]! ^= rk[rkOff + i]!;
    }

    return state;
}
