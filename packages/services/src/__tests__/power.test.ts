/**
 * Smoke tests for power services — verify module loads and singletons.
 */

import {isConservationEnabled} from '../power/batteryConservation';
import Inhibit from '../power/inhibit';
import PowerProfiles from '../power/powerProfiles';
import {describe, expect, it, run} from './test-runner';

import {logoutCurrentSession} from '../power/sessionControl';

describe('logoutCurrentSession', () => {
    it('terminates only the requested session', () => {
        const commands: string[][] = [];
        const succeeded = logoutCurrentSession('session-7', (argv) => {
            commands.push(argv);
            return '';
        });

        expect(succeeded).toBe(true);
        expect(commands).toEqual([['loginctl', 'terminate-session', 'session-7']]);
    });

    it('reports missing session ID without running a termination command', () => {
        const commands: string[][] = [];
        const errors: string[] = [];
        const succeeded = logoutCurrentSession('  ', (argv) => {
            commands.push(argv);
            return '';
        }, (message) => errors.push(message));

        expect(succeeded).toBe(false);
        expect(commands).toEqual([]);
        expect(errors).toEqual(['Could not end the current session: XDG_SESSION_ID is not set']);
    });

    it('reports logind failure and never falls back to terminating the user', () => {
        const commands: string[][] = [];
        const errors: string[] = [];
        const succeeded = logoutCurrentSession('session-7', (argv) => {
            commands.push(argv);
            throw new Error('Access denied');
        }, (message) => errors.push(message));

        expect(succeeded).toBe(false);
        expect(commands).toEqual([['loginctl', 'terminate-session', 'session-7']]);
        expect(errors).toEqual(['Could not end the current session: Access denied']);
    });
});

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
