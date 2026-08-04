/**
 * Tests for core file helpers (file.ts).
 *
 * Uses real temp files in GLib's tmp dir. monitorFile's 'changed' callback
 * delivery is async by nature — only the sync contract (dedup, dispose)
 * plus one main-loop-drained change event are asserted.
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {disposeMonitors, monitorFile, readFile, writeFile} from '../file';
import {describe, expect, it, run} from './test-runner';

function tmpPath(name: string): string {
    return `${GLib.get_tmp_dir()}/shade-test-${GLib.get_real_time()}-${name}`;
}

function drainMainLoop(ms: number): void {
    const ctx = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + ms * 1000;
    while (GLib.get_monotonic_time() < deadline) {
        ctx.iteration(false);
        GLib.usleep(1000);
    }
    // final drain of anything queued
    while (ctx.iteration(false)) {
        /* exhaust */
    }
}

describe('readFile/writeFile', () => {
    it('round-trips content through a temp file', () => {
        const path = tmpPath('rw.txt');
        writeFile(path, 'hello shade');
        expect(readFile(path)).toBe('hello shade');
        Gio.File.new_for_path(path).delete(null);
    });

    it('overwrites existing content', () => {
        const path = tmpPath('rw2.txt');
        writeFile(path, 'first');
        writeFile(path, 'second');
        expect(readFile(path)).toBe('second');
        Gio.File.new_for_path(path).delete(null);
    });
});

describe('monitorFile', () => {
    it('returns a monitor for a new path', () => {
        const path = tmpPath('mon.txt');
        writeFile(path, 'x');
        const mon = monitorFile(path, () => {});
        expect(mon !== null).toBe(true);
        disposeMonitors();
        Gio.File.new_for_path(path).delete(null);
    });

    it('dedupes: second monitor for the same path returns null', () => {
        const path = tmpPath('dedup.txt');
        writeFile(path, 'x');
        const first = monitorFile(path, () => {});
        const second = monitorFile(path, () => {});
        expect(first !== null).toBe(true);
        expect(second).toBe(null);
        disposeMonitors();
        Gio.File.new_for_path(path).delete(null);
    });

    it('disposeMonitors clears dedup state so the path can be re-watched', () => {
        const path = tmpPath('redwatch.txt');
        writeFile(path, 'x');
        monitorFile(path, () => {});
        disposeMonitors();
        const again = monitorFile(path, () => {});
        expect(again !== null).toBe(true);
        disposeMonitors();
        Gio.File.new_for_path(path).delete(null);
    });

    it('fires the callback when the file changes', () => {
        const path = tmpPath('fire.txt');
        writeFile(path, 'before');
        let fired = 0;
        let lastPath: string | null = null;
        const mon = monitorFile(path, (p, _event) => {
            fired++;
            lastPath = p;
        });
        expect(mon !== null).toBe(true);

        writeFile(path, 'after');
        drainMainLoop(300);

        expect(fired > 0).toBe(true);
        // atomic writes go through a .goutputstream-* temp file, so the
        // path may be the temp sibling rather than the watched file
        expect(typeof lastPath === 'string').toBe(true);
        disposeMonitors();
        Gio.File.new_for_path(path).delete(null);
    });
});

await run(import.meta.url);
