import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {normalizeAddress, parseWindowEntries} from '../windowList';

describe('parseWindowEntries (current XDPH: HANDLE[HC>]CLASS[HT>]TITLE[HE>]ADDR[HA>])', () => {
    const env =
        '619159856[HC>]kitty[HT>]~/nixfiles[HE>]107230247799088[HA>]' +
        '42[HC>]zen-alpha[HT>]Backspace[HE>]107230246859584[HA>]' +
        '7[HC>]slack[HT>]no address yet[HE>]0[HA>]';

    it('keeps every entry handle bare — XDPH rejects anything but the uint32', () => {
        expect(parseWindowEntries(env).map((w) => w.id)).toEqual(['619159856', '42', '7']);
    });

    it('converts the decimal address to hyprctl hex and drops a zero address', () => {
        const [first, second, third] = parseWindowEntries(env);
        expect(first.address).toBe(`0x${(107230247799088n).toString(16)}`);
        expect(second.address).toBe(`0x${(107230246859584n).toString(16)}`);
        expect(third.address).toBe('');
    });

    it('keeps class and title per entry', () => {
        const [first, second] = parseWindowEntries(env);
        expect([first.clazz, first.title]).toEqual(['kitty', '~/nixfiles']);
        expect([second.clazz, second.title]).toEqual(['zen-alpha', 'Backspace']);
    });
});

describe('parseWindowEntries (legacy XDPH without [HA>])', () => {
    it('splits on [HE>] and leaves the address empty', () => {
        const windows = parseWindowEntries('1[HC>]kitty[HT>]a[HE>]2[HC>]slack[HT>]b[HE>]');
        expect(windows.map((w) => [w.id, w.clazz, w.title, w.address])).toEqual([
            ['1', 'kitty', 'a', ''],
            ['2', 'slack', 'b', ''],
        ]);
    });
});

describe('normalizeAddress', () => {
    it('rejects non-numeric input', () => {
        expect(normalizeAddress('abc')).toBe('');
        expect(normalizeAddress('')).toBe('');
    });
});

run();
