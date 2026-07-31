/**
 * Smoke test for NetworkService — singleton identity and the
 * bindable wifiEnabled property default before init().
 */
import NetworkService from '../network/networkService';
import {describe, it, expect, run} from './test-runner';

describe('NetworkService', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = NetworkService.get_default();
        const b = NetworkService.get_default();
        expect(a).toBe(b);
    });

    it('wifiEnabled defaults to false before init()', () => {
        const n = NetworkService.get_default();
        expect(n.wifiEnabled).toBe(false);
    });
});

await run(import.meta.url);
