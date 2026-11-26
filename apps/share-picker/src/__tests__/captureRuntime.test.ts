import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {cleanTempDir, ensureTempDir, monPath, TEMP_DIR} from '../capture';

describe('capture runtime directory', () => {
    it('isolates overlapping picker processes and removes its own private files', () => {
        const pid = new Gio.Credentials().get_unix_pid();
        const prefix = `${GLib.get_user_runtime_dir()}/dshell-picker-${pid}-`;
        expect(TEMP_DIR.startsWith(prefix)).toBe(true);
        expect(/^[a-f0-9-]{36}$/.test(TEMP_DIR.slice(prefix.length))).toBe(true);
        ensureTempDir();
        try {
            const directory = Gio.File.new_for_path(TEMP_DIR);
            const info = directory.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
            expect(info.get_attribute_uint32('unix::mode') & 0o777).toBe(0o700);
            GLib.file_set_contents(monPath('test-output'), new Uint8Array([1, 2, 3]));
            expect(GLib.file_test(monPath('test-output'), GLib.FileTest.EXISTS)).toBe(true);
            GLib.file_set_contents(`${TEMP_DIR}/window-0.png`, new Uint8Array([4, 5, 6]));
            expect(GLib.file_test(`${TEMP_DIR}/window-0.png`, GLib.FileTest.EXISTS)).toBe(true);
        } finally {
            cleanTempDir();
        }
        expect(GLib.file_test(TEMP_DIR, GLib.FileTest.EXISTS)).toBe(false);
    });
});

await run(import.meta.url);
