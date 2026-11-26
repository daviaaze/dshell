/**
 * Tests for FrecencyManager (singleton identity) and the pure scoring/ranking helpers.
 *
 * `hasData` is intentionally not asserted: it reflects persisted
 * GSettings state that is only loaded in init(), so it is not hermetic in
 * a bare harness.
 */
import {computeFrecency, FrecencyManager, rerankByBoost} from '../search/frecency';
import {describe, expect, it, run} from './test-runner';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('FrecencyManager', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = FrecencyManager.get_default();
        const b = FrecencyManager.get_default();
        expect(a).toBe(b);
    });
});

describe('computeFrecency', () => {
    const now = 1_700_000_000_000;

    it('halves every 7 days', () => {
        expect(computeFrecency({count: 500, lastLaunched: now}, now)).toBe(1);
        expect(computeFrecency({count: 500, lastLaunched: now - 7 * DAY_MS}, now)).toBe(0.5);
        expect(computeFrecency({count: 500, lastLaunched: now - 14 * DAY_MS}, now)).toBe(0.25);
    });

    it('grows with launch count', () => {
        const few = computeFrecency({count: 2, lastLaunched: now}, now);
        const many = computeFrecency({count: 50, lastLaunched: now}, now);
        expect(many).toBeGreaterThan(few);
        expect(few).toBeGreaterThan(0);
    });
});

describe('rerankByBoost', () => {
    it('keeps fuzzy order when boosts are equal', () => {
        expect(rerankByBoost(['a', 'b', 'c'], () => 1)).toEqual(['a', 'b', 'c']);
    });

    it('lets a boost reorder close matches', () => {
        const boost = (id: string) => (id === 'b' ? 1.5 : 1);
        expect(rerankByBoost(['a', 'b', 'c', 'd', 'e', 'f'], boost)).toEqual([
            'b',
            'a',
            'c',
            'd',
            'e',
            'f',
        ]);
    });

    it('does not lift a weak match above a strong one', () => {
        const ids = ['strong', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'weak'];
        const boost = (id: string) => (id === 'weak' ? 1.5 : 1);
        const ranked = rerankByBoost(ids, boost);
        expect(ranked[0]).toBe('strong');
    });
});

await run(import.meta.url);
