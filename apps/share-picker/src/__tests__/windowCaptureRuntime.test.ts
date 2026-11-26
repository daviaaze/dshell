import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import * as capture from '../capture';
import type {PreviewHandle, PreviewState, WindowState} from '../types';

function windowState(id: string, hyprStableId: string | null): WindowState {
    return {
        kind: 'window',
        info: {id, clazz: 'test-app', title: id, address: `0x${id}`},
        geometry: null,
        hyprAddress: null,
        hyprStableId,
        texture: null,
        capturing: false,
    };
}

function previewRecorder() {
    const states: PreviewState[] = [];
    let textures = 0;
    const handle: PreviewHandle = {
        widget: null!, // Capture only calls the handle's setters; no display is needed.
        setState(state) {
            states.push(state);
        },
        setTexture() {
            textures++;
        },
        dispose() {},
    };
    return {handle, states, textures: () => textures};
}

function waitFor(predicate: () => boolean): Promise<void> {
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    let attempts = 0;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        if (predicate()) {
            resolve();
            return GLib.SOURCE_REMOVE;
        }
        if (++attempts >= 200) {
            reject(new Error('Timed out waiting for the synthetic thumbnail child'));
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    return promise;
}

describe('native window capture lifecycle', () => {
    it.async('launches one exact-ID batch and reaps it without late UI updates on close', async () => {
        const fixture = GLib.dir_make_tmp('shade-window-capture-test-XXXXXX');
        const helper = `${fixture}/shade-window-thumbnail`;
        const record = `${fixture}/invocation.json`;
        try {
            const gjs = GLib.find_program_in_path('gjs');
            if (!gjs) throw new Error('GJS is required to run the capture lifecycle test');
            GLib.file_set_contents(
                helper,
                new TextEncoder().encode(
                    `#!${gjs} -m\n` +
                        "import Gio from 'gi://Gio?version=2.0';\n" +
                        "import GLib from 'gi://GLib?version=2.0';\n" +
                        `GLib.file_set_contents(${JSON.stringify(record)}, new TextEncoder().encode(JSON.stringify({\n` +
                        '    pid: new Gio.Credentials().get_unix_pid(), args: ARGV,\n' +
                        '})));\n' +
                        // Stay alive until stopCaptures reaps this process.
                        'GLib.usleep(10000000);\n'
                )
            );
            Gio.File.new_for_path(helper).set_attribute_uint32(
                'unix::mode',
                0o700,
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            capture.ensureTempDir();
            const windows = [
                windowState('1', 'aBc9'),
                windowState('2', null),
                windowState('3', 'aBc9'),
                windowState('4', '0'),
            ];
            const previews = windows.map(() => previewRecorder());
            const targets = previews.map((preview) => [preview.handle]);
            capture.captureWindows(windows, targets, helper);
            capture.captureWindows(windows, targets, helper);
            await waitFor(() => GLib.file_test(record, GLib.FileTest.IS_REGULAR));
            const [, contents] = GLib.file_get_contents(record);
            const invocation = JSON.parse(new TextDecoder().decode(contents));
            expect(invocation.args).toEqual([
                'aBc9',
                `${capture.TEMP_DIR}/window-0.png`,
                '0',
                `${capture.TEMP_DIR}/window-1.png`,
            ]);
            expect(GLib.file_test(`/proc/${invocation.pid}`, GLib.FileTest.IS_DIR)).toBe(true);
            expect(previews.map((preview) => preview.states)).toEqual([
                ['loading'],
                ['unavailable'],
                ['loading'],
                ['loading'],
            ]);
            capture.stopCaptures();
            expect(GLib.file_test(`/proc/${invocation.pid}`, GLib.FileTest.IS_DIR)).toBe(false);
            await waitFor(() => windows.every((state) => !state.capturing));
            expect(previews.map((preview) => preview.states)).toEqual([
                ['loading'],
                ['unavailable'],
                ['loading'],
                ['loading'],
            ]);
            expect(previews.map((preview) => preview.textures())).toEqual([0, 0, 0, 0]);
        } finally {
            capture.stopCaptures();
            capture.cleanTempDir();
            for (const path of [record, helper]) {
                const file = Gio.File.new_for_path(path);
                if (file.query_exists(null)) file.delete(null);
            }
            Gio.File.new_for_path(fixture).delete(null);
        }
    });
});

await run(import.meta.url);
