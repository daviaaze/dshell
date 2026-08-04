/**
 * Smoke test for FrecencyManager — singleton identity.
 *
 * `hasData` is intentionally not asserted: it reflects persisted
 * GSettings state that is only loaded in init(), so it is not hermetic in
 * a bare harness. The singleton check is the meaningful smoke test here.
 */
import {FrecencyManager} from '../search/frecency';
import {describe, expect, it, run} from './test-runner';

describe('FrecencyManager', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = FrecencyManager.get_default();
        const b = FrecencyManager.get_default();
        expect(a).toBe(b);
    });
});

await run(import.meta.url);
