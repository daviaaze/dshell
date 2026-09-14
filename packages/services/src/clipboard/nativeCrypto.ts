/**
 * NativeCrypto — AES-256-CTR + HMAC-SHA256 (encrypt-then-MAC) via openssl.
 *
 * GJS 1.88 has no Web Crypto API and pure-JS AES (cryptoEngine.ts) ran at
 * ~2.8 MB/s, which froze the main loop for 62 s on a large history blob.
 * openssl's `enc` rejects AEAD modes ("AEAD ciphers not supported"), so we
 * use AES-256-CTR for confidentiality plus HMAC-SHA256 over the ciphertext
 * (encrypt-then-MAC) for integrity — both natively supported and fast.
 *
 * All I/O happens through Gio.Subprocess.communicate_async so encryption
 * and decryption never block the GJS main loop.
 *
 * @module nativeCrypto
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';

/** Encrypted payload produced by encryptNative / consumed by decryptNative. */
export interface SealedBlob {
    /** 16-byte CTR IV. */
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    /** 32-byte HMAC-SHA256 over ciphertext. */
    mac: Uint8Array;
}

export const CTR_IV_SIZE = 16;
export const HMAC_SIZE = 32;

// undefined = not probed yet; null = not found (persistence disabled).
let opensslPath: string | null | undefined;

function getOpenssl(): string | null {
    if (opensslPath !== undefined) return opensslPath;
    const found = Process.findBinary('openssl');
    // findBinary falls back to the bare name when `which` fails.
    opensslPath = found !== 'openssl' ? found : null;
    if (!opensslPath) {
        logger.error(
            'clipboard',
            'openssl binary not found — clipboard history persistence disabled (in-memory only)'
        );
    }
    return opensslPath;
}

/**
 * Run openssl with `args`, feeding `input` on stdin, resolving stdout bytes.
 * Never blocks the main loop.
 */
function runOpenSSL(args: string[], input: Uint8Array): Promise<Uint8Array> {
    const bin = getOpenssl();
    if (!bin) {
        return Promise.reject(new Error('openssl binary not found'));
    }
    const {promise, resolve, reject} = Promise.withResolvers<Uint8Array>();
    let proc: Gio.Subprocess;
    try {
        proc = Gio.Subprocess.new(
            [bin, ...args],
            Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return promise;
    }
    proc.communicate_async(new GLib.Bytes(input), null, (_, res) => {
        try {
            const [, stdout, stderr] = proc.communicate_finish(res);
            if (proc.get_successful()) {
                resolve(stdout ? stdout.toArray() : new Uint8Array(0));
            } else {
                const errText = stderr
                    ? new TextDecoder().decode(stderr.toArray()).trim()
                    : '';
                reject(
                    new Error(errText || `openssl exited with status ${proc.get_exit_status()}`)
                );
            }
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
    return promise;
}

/**
 * Encrypt plaintext: random IV, AES-256-CTR, then HMAC-SHA256 over the
 * ciphertext. Key must be 32 bytes.
 */
export async function encryptNative(key: Uint8Array, plaintext: Uint8Array): Promise<SealedBlob> {
    const nonce = getRandomBytes(CTR_IV_SIZE);
    const keyHex = bytesToHex(key);
    const ciphertext = await runOpenSSL(
        ['enc', '-aes-256-ctr', '-K', keyHex, '-iv', bytesToHex(nonce)],
        plaintext
    );
    const mac = await runOpenSSL(
        ['dgst', '-sha256', '-mac', 'HMAC', '-macopt', `hexkey:${keyHex}`, '-binary'],
        ciphertext
    );
    return {nonce, ciphertext, mac};
}

/**
 * Decrypt a SealedBlob. Verifies the HMAC first (constant-time) and throws
 * on mismatch, so tampered data never reaches the decrypt step.
 */
export async function decryptNative(key: Uint8Array, blob: SealedBlob): Promise<Uint8Array> {
    const keyHex = bytesToHex(key);
    const expectedMac = await runOpenSSL(
        ['dgst', '-sha256', '-mac', 'HMAC', '-macopt', `hexkey:${keyHex}`, '-binary'],
        blob.ciphertext
    );
    if (!constantTimeEqual(expectedMac, blob.mac)) {
        throw new Error('clipboard MAC verification failed');
    }
    return runOpenSSL(
        ['enc', '-d', '-aes-256-ctr', '-K', keyHex, '-iv', bytesToHex(blob.nonce)],
        blob.ciphertext
    );
}

/** Generate a random 32-byte AES-256 key from /dev/urandom. */
export function generateKeyNative(): Uint8Array {
    return getRandomBytes(32);
}

/** Read `count` cryptographically random bytes from /dev/urandom. */
function getRandomBytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    try {
        let off = 0;
        while (off < count) {
            const chunk = stream.read_bytes(count - off, null);
            const data = chunk.toArray();
            if (data.length === 0) break;
            out.set(data, off);
            off += data.length;
        }
    } finally {
        stream.close(null);
    }
    return out;
}

/** Convert Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return hex;
}

/** Convert a hex string to Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Constant-time comparison — never short-circuits on early byte match. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i]! ^ b[i]!;
    }
    return diff === 0;
}