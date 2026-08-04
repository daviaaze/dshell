/**
 * Smoke test for ColorScheme — singleton identity and the
 * bindable colorSchemeName property is accessible before init().
 */
import {ColorScheme} from '../display/colorScheme';
import {describe, expect, it, run} from './test-runner';

describe('ColorScheme', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = ColorScheme.get_default();
        const b = ColorScheme.get_default();
        expect(a).toBe(b);
    });

    it('colorSchemeName is accessible before init()', () => {
        const s = ColorScheme.get_default();
        expect(typeof s.colorSchemeName).toBe('string');
    });
});

await run(import.meta.url);
