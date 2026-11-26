import {isHourInDndWindow} from '../notifications/dndSchedule';
import {describe, expect, it, run} from './test-runner';

describe('isHourInDndWindow', () => {
    it('covers only the hours of a same-day window', () => {
        expect(isHourInDndWindow(8, 9, 17)).toBe(false);
        expect(isHourInDndWindow(9, 9, 17)).toBe(true);
        expect(isHourInDndWindow(16, 9, 17)).toBe(true);
        expect(isHourInDndWindow(17, 9, 17)).toBe(false);
        expect(isHourInDndWindow(23, 9, 17)).toBe(false);
    });

    it('wraps past midnight for an overnight window', () => {
        expect(isHourInDndWindow(21, 22, 7)).toBe(false);
        expect(isHourInDndWindow(22, 22, 7)).toBe(true);
        expect(isHourInDndWindow(0, 22, 7)).toBe(true);
        expect(isHourInDndWindow(6, 22, 7)).toBe(true);
        expect(isHourInDndWindow(7, 22, 7)).toBe(false);
        expect(isHourInDndWindow(12, 22, 7)).toBe(false);
    });

    it('treats equal start and end as an empty window', () => {
        expect(isHourInDndWindow(0, 8, 8)).toBe(false);
        expect(isHourInDndWindow(8, 8, 8)).toBe(false);
        expect(isHourInDndWindow(23, 8, 8)).toBe(false);
    });
});

run(import.meta.url);
