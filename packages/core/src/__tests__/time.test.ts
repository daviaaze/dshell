/**
 * Tests for the pure time helpers in core/time.ts.
 */

import {fmtDuration, formatOffsetHours} from '../time';
import {describe, expect, it, run} from './test-runner';

describe('formatOffsetHours', () => {
    it('formats whole-hour offsets with a sign', () => {
        expect(formatOffsetHours(8)).toBe('+8h');
        expect(formatOffsetHours(-3)).toBe('-3h');
    });

    it('reports an equal offset as the same time', () => {
        expect(formatOffsetHours(0)).toBe('same time');
    });

    it('keeps the minutes of half-hour and 45-minute zones', () => {
        // UTC-3 against Kolkata (+5:30) is 8h30, not a rounded 9h.
        expect(formatOffsetHours(8.5)).toBe('+8h30');
        expect(formatOffsetHours(-9.5)).toBe('-9h30');
        expect(formatOffsetHours(5.75)).toBe('+5h45');
    });
});

describe('fmtDuration', () => {
    it('formats minutes and seconds under an hour', () => {
        expect(fmtDuration(65_000)).toBe('1:05');
        expect(fmtDuration(300_000)).toBe('5:00');
    });

    it('adds hours when needed', () => {
        expect(fmtDuration(3_665_000)).toBe('1:01:05');
    });

    it('clamps negative durations to zero', () => {
        expect(fmtDuration(-5000)).toBe('0:00');
    });
});

await run(import.meta.url);
