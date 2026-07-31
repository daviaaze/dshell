/**
 * Smoke test for SystemUsage — singleton identity and the
 * reactive temp Accessor is initialized by the constructor.
 *
 * Note: the service's GObject-derived accessors (cpu/memory/disk/temp)
 * are reactive (Accessor<T>, callable) rather than plain values.
 */
import SystemUsage from '../monitoring/systemUsage';
import {describe, it, expect, run} from './test-runner';

describe('SystemUsage', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = SystemUsage.get_default();
        const b = SystemUsage.get_default();
        expect(a).toBe(b);
    });

    it('temp Accessor is initialized to 0 by the constructor', () => {
        const s = SystemUsage.get_default();
        expect(s.temp()).toBe(0);
    });
});

await run(import.meta.url);
