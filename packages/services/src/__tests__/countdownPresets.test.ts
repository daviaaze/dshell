import {
    MAX_COUNTDOWN_PRESET_MINUTES,
    validateCountdownPreset,
} from '../time/countdownPresets';
import {describe, expect, it, run} from './test-runner';

describe('validateCountdownPreset', () => {
    it('requires non-empty whole signed decimal input', () => {
        expect(validateCountdownPreset('   ', [])).toEqual({kind: 'empty'});
        for (const raw of ['5x', '1.5', '1e2', '--1', '+', '0x10']) {
            expect(validateCountdownPreset(raw, []).kind).toBe('not-integer');
        }
    });

    it('accepts trimmed positive signed decimal values and normalizes duplicates', () => {
        expect(validateCountdownPreset(' +0005 ', [])).toEqual({kind: 'valid', minutes: 5});
        expect(validateCountdownPreset('+0005', [5])).toEqual({kind: 'duplicate', minutes: 5});
        expect(validateCountdownPreset('05', [5])).toEqual({kind: 'duplicate', minutes: 5});
    });

    it('rejects zero, negative, unsafe, and out-of-int32 values', () => {
        for (const raw of ['0', '-1', '+0', '9007199254740992']) {
            expect(validateCountdownPreset(raw, []).kind).toBe('out-of-range');
        }
        expect(validateCountdownPreset(String(MAX_COUNTDOWN_PRESET_MINUTES), [])).toEqual({
            kind: 'valid',
            minutes: MAX_COUNTDOWN_PRESET_MINUTES,
        });
        expect(validateCountdownPreset(String(MAX_COUNTDOWN_PRESET_MINUTES + 1), [])).toEqual({
            kind: 'out-of-range',
        });
    });
});

run(import.meta.url);
