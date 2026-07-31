/**
 * Tests for DismissTimers — per-notification dismiss timers with pause/resume.
 *
 * Run: gjs -m src/lib/__tests__/dismissTimers.test.ts
 */

import {describe, it, expect, run} from './test-runner';
import {DismissTimers} from '../notifications/dismissTimers';
import GLib from 'gi://GLib?version=2.0';

function delayMs(ms: number): Promise<void> {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

describe('DismissTimers', () => {
    it('expires after the scheduled delay', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 10);
        await delayMs(30);
        expect(expired).toBe([1]);
        timers.clear();
    });

    it('cancel() prevents expiry', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 10);
        timers.cancel(1);
        await delayMs(30);
        expect(expired.length).toBe(0);
        expect(timers.size).toBe(0);
    });

    it('pause() stops the timer; resume() restarts it', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 20);
        timers.pause(1);
        await delayMs(30);
        expect(expired.length).toBe(0);

        timers.resume(1, 10);
        await delayMs(30);
        expect(expired).toBe([1]);
        timers.clear();
    });

    it('resume() is a no-op while a timer is pending', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 20);
        timers.resume(1, 5000); // must not replace the pending 20ms timer
        await delayMs(40);
        expect(expired).toBe([1]);
    });

    it('tracks timers independently per id', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 10);
        timers.schedule(2, 60);
        await delayMs(30);
        expect(expired).toBe([1]);
        expect(timers.has(2)).toBe(true);
        timers.cancel(2);
    });

    it('clear() cancels everything', async () => {
        const expired: number[] = [];
        const timers = new DismissTimers(id => expired.push(id));
        timers.schedule(1, 10);
        timers.schedule(2, 10);
        timers.clear();
        expect(timers.size).toBe(0);
        await delayMs(30);
        expect(expired.length).toBe(0);
    });
});

run(import.meta.url);
