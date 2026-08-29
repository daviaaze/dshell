/**
 * Smoke tests for power services — verify module loads and singletons.
 */

import {isConservationEnabled} from '../power/batteryConservation';
import Inhibit from '../power/inhibit';
import PowerProfiles from '../power/powerProfiles';
import {describe, expect, it, run} from './test-runner';

describe('Inhibit', () => {
    const reset = () => {
        const inhib = Inhibit.get_default();
        inhib.setDuration(0);
        if (inhib.idle) inhib.idle = false;
    };

    it('get_default returns same instance', () => {
        reset();
        const a = Inhibit.get_default();
        const b = Inhibit.get_default();
        expect(a).toBe(b);
    });

    it('idle defaults to false', () => {
        reset();
        expect(Inhibit.get_default().idle).toBe(false);
    });

    it('remaining is empty string when idle is false', () => {
        reset();
        const inhib = Inhibit.get_default();
        inhib.idle = false;
        expect(inhib.remaining).toBe('');
    });

    it('remaining is non-empty when idle is true with duration', () => {
        reset();
        const inhib = Inhibit.get_default();
        inhib.setDuration(1);
        inhib.idle = true;
        expect(inhib.idle).toBe(true);
        expect(inhib.remaining).toBeTruthy();
    });

    it('remaining is empty string when idle is true but duration is 0 (indefinite)', () => {
        reset();
        const inhib = Inhibit.get_default();
        inhib.setDuration(0);
        inhib.idle = true;
        expect(inhib.idle).toBe(true);
        expect(inhib.remaining).toBe('');
    });

    it('idle=false after idle=true resets state', () => {
        reset();
        const inhib = Inhibit.get_default();
        inhib.setDuration(0);
        inhib.idle = true;
        expect(inhib.idle).toBe(true);
        inhib.idle = false;
        expect(inhib.idle).toBe(false);
        expect(inhib.remaining).toBe('');
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
