/**
 * Tests for ShellState — shared shell state management.
 *
 * Run via: pnpm test (or manually: gjs -m src/lib/__tests__/shellState.test.ts)
 */

import ShellState from '#/lib/services/state/shellState';
import {describe, it, expect, run} from './test-runner';

describe('ShellState singleton', () => {
    it('get_default returns the same instance', () => {
        const a = ShellState.get_default();
        const b = ShellState.get_default();
        expect(a).toBe(b);
    });

    it('launcher starts closed', () => {
        const s = ShellState.get_default();
        expect(s.launcherOpen).toBe(false);
    });

    it('closeLauncher clears query and sets open to false', () => {
        const s = ShellState.get_default();

        // Open launcher with a query
        s.launcherOpen = true;
        s.launcherQuery = 'firefox';
        expect(s.launcherOpen).toBe(true);
        expect(s.launcherQuery).toBe('firefox');

        // Close — should clear both
        s.closeLauncher();
        expect(s.launcherOpen).toBe(false);
        expect(s.launcherQuery).toBe('');
    });

    it('closeLauncher is idempotent', () => {
        const s = ShellState.get_default();
        s.launcherOpen = false;
        s.launcherQuery = '';

        // Calling when already closed should not throw
        s.closeLauncher();
        expect(s.launcherOpen).toBe(false);
        expect(s.launcherQuery).toBe('');
    });
});

await run(import.meta.url);
