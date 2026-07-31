/**
 * Smoke test for ShellState — singleton identity and the
 * bindable launcherOpen property default before init().
 */
import ShellState from '../state/shellState';
import {describe, it, expect, run} from './test-runner';

describe('ShellState', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = ShellState.get_default();
        const b = ShellState.get_default();
        expect(a).toBe(b);
    });

    it('launcherOpen defaults to false before init()', () => {
        const s = ShellState.get_default();
        expect(s.launcherOpen).toBe(false);
    });
});

await run(import.meta.url);
