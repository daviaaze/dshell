/**
 * Smoke test for TrayService — singleton identity and the
 * bindable items property default before init().
 */
import TrayService from '../desktop/trayService';
import {describe, expect, it, run} from './test-runner';

describe('TrayService', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = TrayService.get_default();
        const b = TrayService.get_default();
        expect(a).toBe(b);
    });

    it('items defaults to an empty array before init()', () => {
        const s = TrayService.get_default();
        expect(s.items).toEqual([]);
    });
});

await run(import.meta.url);
