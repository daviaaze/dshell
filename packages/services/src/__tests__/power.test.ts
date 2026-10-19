/**
 * Power service behavior: targeted logout and inhibition transitions.
 */

import Inhibit from '../power/inhibit';
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

    it('switches finite to indefinite and back without releasing inhibition', () => {
        reset();
        const inhibit = Inhibit.get_default();
        inhibit.setDuration(1);
        expect(inhibit.idle).toBe(true);
        expect(inhibit.remaining).toBe('1:00');
        inhibit.startIndefinite();
        expect(inhibit.idle).toBe(true);
        expect(inhibit.remaining).toBe('');
        inhibit.setDuration(2);
        expect(inhibit.idle).toBe(true);
        expect(inhibit.remaining).toBe('2:00');
        inhibit.idle = false;
        expect(inhibit.remaining).toBe('');
    });

    it('retains duration-zero Off semantics after explicit indefinite activation', () => {
        reset();
        const inhibit = Inhibit.get_default();
        inhibit.startIndefinite();
        expect(inhibit.idle).toBe(true);
        inhibit.setDuration(0);
        expect(inhibit.idle).toBe(false);
        expect(inhibit.remaining).toBe('');
    });
});


await run(import.meta.url);
