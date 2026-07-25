/**
 * Tests for Timeout — one-shot cancellable timer.
 *
 * Run: gjs -m src/lib/__tests__/timeout.test.ts
 */

import {Timeout} from '#/lib/core/timeout';
import GLib from 'gi://GLib?version=2.0';
import {describe, it, expect, run} from './test-runner';

function delayMs(ms: number): Promise<void> {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

describe('Timeout', () => {
    it('fires callback after the specified delay', async () => {
        const t = new Timeout();
        let fired = false;
        t.start(10, () => {
            fired = true;
        });
        await delayMs(20);
        expect(fired).toBe(true);
        t.cancel();
    });

    it('cancel() prevents callback from firing', async () => {
        const t = new Timeout();
        let fired = false;
        t.start(50, () => {
            fired = true;
        });
        t.cancel();
        await delayMs(80);
        expect(fired).toBe(false);
    });

    it('pending returns true while timeout is active', () => {
        const t = new Timeout();
        expect(t.pending).toBe(false);
        t.start(100, () => {});
        expect(t.pending).toBe(true);
        t.cancel();
        expect(t.pending).toBe(false);
    });

    it('start() cancels any previous pending timeout', async () => {
        const t = new Timeout();
        const calls: number[] = [];
        t.start(50, () => calls.push(1));
        t.start(10, () => calls.push(2));
        await delayMs(80);
        // Only the second callback should have fired
        expect(calls).toEqual([2]);
        t.cancel();
    });

    it('does not fire after cancel + restart race', async () => {
        const t = new Timeout();
        let count = 0;
        t.start(5, () => count++);
        await delayMs(10);
        // First one fired
        t.start(5, () => count++);
        t.cancel();
        await delayMs(10);
        // Second was cancelled
        expect(count).toBe(1);
    });
});

await run(import.meta.url);
