/**
 * Maintained native crypto in a packaged, private-stdin worker.
 * New blobs use AES-256-GCM; legacy readers live exclusively in the worker.
 * No key is placed in subprocess argv, environment, or a temporary file.
 */
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';

declare global {
    interface ImportMeta {
        readonly clipboardCryptoPath?: string;
    }
}

export interface SealedBlob {
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    /** GCM authentication tag. */
    mac: Uint8Array;
}

const HEADER = new Uint8Array([0x53, 0x48, 0x45, 0x44, 0, 0, 0, 4]);
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const WORKER_TIMEOUT_MS = 10000;

async function runWorker(
    operation: 'encrypt' | 'decrypt' | 'write' | 'load',
    key: Uint8Array,
    input: Uint8Array = new Uint8Array(0),
    path?: string
): Promise<Uint8Array> {
    if (key.length !== 32) throw new Error('clipboard key must be 32 bytes');
    const worker =
        import.meta.clipboardCryptoPath ?? `${import.meta.bindir}/shade-clipboard-crypto`;
    const process = Gio.Subprocess.new(
        [worker, operation, ...(path ? [path] : [])],
        Gio.SubprocessFlags.STDIN_PIPE |
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE
    );
    const request = new Uint8Array(key.length + input.length);
    request.set(key);
    request.set(input, key.length);
    let timedOut = false;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORKER_TIMEOUT_MS, () => {
        timedOut = true;
        process.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    try {
        const {promise, resolve, reject} = Promise.withResolvers<Uint8Array>();
        process.communicate_async(new GLib.Bytes(request), null, (_, result) => {
            try {
                const [, stdout, stderr] = process.communicate_finish(result);
                const warning = stderr ? new TextDecoder().decode(stderr.toArray()).trim() : '';
                if (!process.get_successful()) {
                    reject(
                        new Error(
                            timedOut
                                ? 'clipboard worker timed out'
                                : warning || 'clipboard worker failed'
                        )
                    );
                } else {
                    if (warning) logger.warn('clipboard', warning);
                    resolve(stdout?.toArray() ?? new Uint8Array(0));
                }
            } catch (error) {
                reject(error);
            }
        });
        return await promise;
    } finally {
        if (!timedOut) GLib.source_remove(timer);
        request.fill(0);
    }
}

export async function encryptNative(key: Uint8Array, plaintext: Uint8Array): Promise<SealedBlob> {
    const output = await runWorker('encrypt', key, plaintext);
    if (
        output.length < HEADER.length + NONCE_SIZE + TAG_SIZE ||
        !HEADER.every((byte, index) => output[index] === byte)
    ) {
        throw new Error('invalid encrypted clipboard worker response');
    }
    return {
        nonce: output.slice(HEADER.length, HEADER.length + NONCE_SIZE),
        ciphertext: output.slice(HEADER.length + NONCE_SIZE, -TAG_SIZE),
        mac: output.slice(-TAG_SIZE),
    };
}

export async function decryptNative(key: Uint8Array, blob: SealedBlob): Promise<Uint8Array> {
    if (blob.nonce.length !== NONCE_SIZE || blob.mac.length !== TAG_SIZE) {
        throw new Error('invalid clipboard GCM framing');
    }
    const input = new Uint8Array(HEADER.length + NONCE_SIZE + blob.ciphertext.length + TAG_SIZE);
    input.set(HEADER);
    input.set(blob.nonce, HEADER.length);
    input.set(blob.ciphertext, HEADER.length + NONCE_SIZE);
    input.set(blob.mac, input.length - TAG_SIZE);
    return runWorker('decrypt', key, input);
}

/** The worker owns migration, authentication and all blocking disk reads. */
export function loadHistoryNative(key: Uint8Array, path: string): Promise<Uint8Array> {
    return runWorker('load', key, undefined, path);
}

/** Resolves only after a private atomic write and both file/directory fsyncs. */
export async function writeHistoryNative(
    key: Uint8Array,
    path: string,
    plaintext: Uint8Array
): Promise<void> {
    await runWorker('write', key, plaintext, path);
}

export function generateKeyNative(): Uint8Array {
    const key = new Uint8Array(32);
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    try {
        let offset = 0;
        while (offset < key.length) {
            const chunk = stream.read_bytes(key.length - offset, null).toArray();
            if (chunk.length === 0) throw new Error('could not read clipboard key entropy');
            key.set(chunk, offset);
            offset += chunk.length;
        }
    } catch (error) {
        key.fill(0);
        throw error;
    } finally {
        stream.close(null);
    }
    return key;
}

export function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return hex;
}

/** Reject corrupt keyring values rather than silently truncating/coercing. */
export function hexToBytes(hex: string): Uint8Array {
    if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error('clipboard keyring value must contain exactly 64 hex digits');
    }
    const key = new Uint8Array(32);
    for (let index = 0; index < key.length; index++) {
        key[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return key;
}
