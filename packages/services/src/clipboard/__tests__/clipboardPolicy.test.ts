import {describe, expect, it, run} from '../../__tests__/test-runner';
import {imageMimeType} from '../clipboardPolicy';
import {hexToBytes} from '../nativeCrypto';

describe('clipboard offer policy', () => {
    it('stores image data using its real MIME type', () => {
        expect(imageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(
            imageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ).toBe('image/png');
        expect(imageMimeType(new Uint8Array([0x42, 0x4d]))).toBe('image/bmp');
        expect(imageMimeType(new Uint8Array([1, 2, 3]))).toBeNull();
    });
    it('rejects invalid or truncated keyring values', () => {
        for (const value of [
            '',
            'ab',
            'f'.repeat(63),
            'z'.repeat(64),
            `${'f'.repeat(64)}\n`,
            `${'f'.repeat(63)}\n`,
        ]) {
            expect(() => hexToBytes(value)).toThrow();
        }
        expect(hexToBytes('aB'.repeat(32)).length).toBe(32);
        expect(hexToBytes('aB'.repeat(32))[0]).toBe(0xab);
    });
});

await run(import.meta.url);
