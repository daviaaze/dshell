/**
 * Tests for Clock — shared 1Hz wall-clock tick.
 *
 * Run: gjs -m src/lib/__tests__/clock.test.ts
 */

import Clock from '../services/time/clock';
import GLib from 'gi://GLib?version=2.0';
import {describe, it, expect, run} from './test-runner';

describe('Clock singleton', () => {
    it('get_default returns the same instance', () => {
        const a = Clock.get_default();
        const b = Clock.get_default();
        expect(a).toBe(b);
    });

    it('time returns a GLib.DateTime', () => {
        const c = Clock.get_default();
        const t = c.time();
        expect(t instanceof GLib.DateTime).toBe(true);
    });

    it('time value updates over time', async () => {
        const c = Clock.get_default();
        const t1 = c.time().to_unix();

        // Wait a bit more than 1s for the tick to fire
        await new Promise<void>(resolve => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1100, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });

        const t2 = c.time().to_unix();
        expect(t2 >= t1).toBe(true);
    });
});

await run(import.meta.url);
