import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {startClipboardWatcher, stopClipboardWatcher} from '../clipboardWatcher';

const FAKE_WL_PASTE = `#!/bin/sh
if [ "$1" = --list-types ]; then printf '%s\\n' "$CLIP_TEST_TYPES"; exit 0; fi
printf 'start\\n' >> "$CLIP_TEST_COUNTER"
while [ "$#" -gt 0 ] && [ "$1" != --watch ]; do shift; done
shift
printf '%s' 'clipboard sample' | "$@"
`;

async function capture(
    types: string,
    state: string,
    duration = 80
): Promise<{captured: string[]; starts: number}> {
    const directory = GLib.dir_make_tmp('shade-clipboard-watcher-test-XXXXXX');
    const executable = Gio.File.new_for_path(`${directory}/wl-paste`);
    const counter = Gio.File.new_for_path(`${directory}/starts`);
    const environment = [
        'PATH',
        'CLIP_TEST_TYPES',
        'CLIPBOARD_STATE',
        'CLIP_TEST_COUNTER',
    ] as const;
    const previous = environment.map((name) => GLib.getenv(name));
    GLib.file_set_contents(executable.get_path()!, new TextEncoder().encode(FAKE_WL_PASTE));
    executable.set_attribute_uint32(
        'unix::mode',
        0o700,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null
    );
    GLib.setenv('PATH', `${directory}:${GLib.getenv('PATH') ?? ''}`, true);
    GLib.setenv('CLIP_TEST_TYPES', types, true);
    GLib.setenv('CLIPBOARD_STATE', state, true);
    GLib.setenv('CLIP_TEST_COUNTER', counter.get_path()!, true);
    const captured: string[] = [];
    try {
        startClipboardWatcher((type, bytes, mime) =>
            captured.push(`${type}:${mime}:${new TextDecoder().decode(bytes)}`)
        );
        const {promise, resolve} = Promise.withResolvers<void>();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        await promise;
        stopClipboardWatcher();
        const [, contents] = counter.load_contents(null);
        return {captured, starts: new TextDecoder().decode(contents).trim().split('\n').length};
    } finally {
        stopClipboardWatcher();
        for (const [index, name] of environment.entries()) {
            const value = previous[index];
            if (value === null || value === undefined) GLib.unsetenv(name);
            else GLib.setenv(name, value, true);
        }
        executable.delete(null);
        if (counter.query_exists(null)) counter.delete(null);
        Gio.File.new_for_path(directory).delete(null);
    }
}

describe('clipboard watcher privacy', () => {
    it.async('normal text still reaches history', async () => {
        const result = await capture('text/plain', 'data');
        expect(result.captured).toContain('text:text/plain:clipboard sample');
    });
    it.async('uses the original offer MIME when wl-paste supplies CLIPBOARD_TYPE', async () => {
        const previous = GLib.getenv('CLIPBOARD_TYPE');
        GLib.setenv('CLIPBOARD_TYPE', 'image/x-custom', true);
        try {
            const result = await capture('image/x-custom\nimage/png', 'data');
            expect(result.captured).toContain('image:image/x-custom:clipboard sample');
        } finally {
            if (previous === null) GLib.unsetenv('CLIPBOARD_TYPE');
            else GLib.setenv('CLIPBOARD_TYPE', previous, true);
        }
    });

    it.async('password-manager MIME hints never reach history', async () => {
        for (const hint of [
            'x-kde-passwordManagerHint',
            'application/x-kde-passwordManagerHint',
            'application/x-keepassxc-clipboard-secret',
        ]) {
            const result = await capture(`text/plain\n${hint}`, 'data');
            expect(result.captured.length).toBe(0);
        }
    });

    it.async('sensitive, nil and clear clipboard states never reach history', async () => {
        for (const state of ['sensitive', 'nil', 'clear']) {
            const result = await capture('text/plain', state);
            expect(result.captured.length).toBe(0);
        }
    });

    it.async('an exited watcher is restarted instead of silently stopping', async () => {
        const result = await capture('text/plain', 'data', 400);
        expect(result.starts).toBeGreaterThan(2);
    });
});

await run(import.meta.url);
