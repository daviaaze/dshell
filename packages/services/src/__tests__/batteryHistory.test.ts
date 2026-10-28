import {resampleHistory} from '../power/batteryHistory';
import {describe, expect, it, run} from './test-runner';

describe('resampleHistory', () => {
    it('starts the series at the first sample and carries values forward', () => {
        // span 100s, 4 slots ending at t=100,  i.e. slot ends at 25/50/75/100.
        const out = resampleHistory(
            [
                [40, 80, 2],
                [90, 60, 2],
            ],
            100,
            100,
            4
        );
        // Slot ending 25 has no data yet → dropped; 50 and 75 carry 80%; 100 takes 60%.
        expect(out.length).toBe(3);
        expect(out[0]).toBe(0.8);
        expect(out[1]).toBe(0.8);
        expect(out[2]).toBe(0.6);
    });

    it('accepts unsorted UPower entries and ignores zero timestamps', () => {
        const out = resampleHistory(
            [
                [90, 60, 2],
                [0, 10, 0],
                [10, 100, 1],
            ],
            100,
            100,
            2
        );
        expect(out.length).toBe(2);
        expect(out[0]).toBe(1);
        expect(out[1]).toBe(0.6);
    });

    it('returns no points when there is no history', () => {
        expect(resampleHistory([], 100, 100, 4).length).toBe(0);
    });
});

run();
