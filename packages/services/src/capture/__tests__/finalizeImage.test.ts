import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Process} from '@shade/core/process';
import {bus} from '../../bus';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {finalizeImage, observeCapture, type CaptureUpdate} from '../utils';

describe('Screenshot finalization', () => {
    it.async('reports a saved screenshot as successful when clipboard copy fails', async () => {
        const originalFind = Process.findBinary;
        const originalExec = Process.execAsyncv;
        const originalDisplay = Gdk.Display.get_default;
        const directory = GLib.dir_make_tmp('shade-finalize-test-XXXXXX');
        const filename = `${directory}/saved.png`;
        const updates: CaptureUpdate[] = [];
        const notifications: string[][] = [];
        let completed = 0;
        const unobserve = observeCapture((update) => updates.push(update));
        const unsubscribe = bus.on('capture:screenshot', () => completed++);
        Process.findBinary = () => 'wl-copy';
        Process.execAsyncv = async (argv) => {
            notifications.push(argv);
            return '';
        };
        Gdk.Display.get_default = () => null;
        try {
            Gio.File.new_for_path(filename).replace_contents(
                new Uint8Array([1]),
                null,
                false,
                Gio.FileCreateFlags.PRIVATE,
                null
            );
            await finalizeImage(filename, false);
            expect(updates).toEqual([{state: 'result', kind: 'screenshot', path: filename}]);
            expect(completed).toBe(1);
            expect(notifications.length).toBe(1);
            expect(notifications[0]).toContain('dialog-warning-symbolic');
            expect(Gio.File.new_for_path(filename).query_exists(null)).toBe(true);
        } finally {
            unobserve();
            unsubscribe();
            Process.findBinary = originalFind;
            Process.execAsyncv = originalExec;
            Gdk.Display.get_default = originalDisplay;
            const file = Gio.File.new_for_path(filename);
            if (file.query_exists(null)) file.delete(null);
            Gio.File.new_for_path(directory).delete(null);
        }
    });
});

await run(import.meta.url);
