/**
 * Smoke tests for power services — verify module loads and singletons.
 */

import {isConservationEnabled} from '../power/batteryConservation';
import Inhibit from '../power/inhibit';
import PowerProfiles from '../power/powerProfiles';
import {describe, expect, it, run} from './test-runner';

describe('Inhibit', () => {
    it('get_default returns same instance', () => {
        const a = Inhibit.get_default();
        const b = Inhibit.get_default();
        expect(a).toBe(b);
    });
});

describe('PowerProfiles', () => {
    it('get_default returns same instance', () => {
        const a = PowerProfiles.get_default();
        const b = PowerProfiles.get_default();
        expect(a).toBe(b);
    });
});

describe('BatteryConservation', () => {
    it('isConservationEnabled returns boolean', () => {
        const v = isConservationEnabled();
        expect(typeof v).toBe('boolean');
    });
});

await run(import.meta.url);
