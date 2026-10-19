import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {describe, expect, it, run} from './test-runner';
import {readAutostartEntries, setAutostartEnabled} from '../settings/autostart';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function makeTempDirectory(): string {
    return GLib.dir_make_tmp(null);
}

function writeFile(directory: string, name: string, contents: string): string {
    const path = GLib.build_filenamev([directory, name]);
    GLib.file_set_contents(path, ENCODER.encode(contents));
    return path;
}

function removeTempDirectory(directory: string): void {
    const folder = Gio.File.new_for_path(directory);
    const enumerator = folder.enumerate_children(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        null
    );
    try {
        let info = enumerator.next_file(null);
        while (info !== null) {
            GLib.unlink(GLib.build_filenamev([directory, info.get_name()]));
            info = enumerator.next_file(null);
        }
    } finally {
        enumerator.close(null);
        GLib.rmdir(directory);
    }
}

describe('Autostart settings', () => {
    it('treats a missing directory as empty without creating it', () => {
        const parent = makeTempDirectory();
        const missing = GLib.build_filenamev([parent, 'not-created']);
        try {
            const result = readAutostartEntries(missing);
            expect(result.entries).toEqual([]);
            expect(result.issues).toEqual([]);
            expect(result.directoryError).toBeNull();
            expect(Gio.File.new_for_path(missing).query_exists(null)).toBe(false);
        } finally {
            removeTempDirectory(parent);
        }
    });

    it('reports an unreadable directory separately from an empty one', () => {
        const directory = makeTempDirectory();
        try {
            const notDirectory = writeFile(directory, 'not-a-directory', 'plain file');
            const result = readAutostartEntries(notDirectory);
            expect(result.entries).toEqual([]);
            expect(result.directoryError !== null).toBe(true);
        } finally {
            removeTempDirectory(directory);
        }
    });

    it('reads Hidden only in Desktop Entry and retains valid siblings beside invalid files', () => {
        const directory = makeTempDirectory();
        try {
            const visible = writeFile(
                directory,
                'visible.desktop',
                '[Other]\nHidden=true\n[Desktop Entry]\nName=Visible\n'
            );
            writeFile(directory, 'hidden.desktop', '[Desktop Entry]\nHidden=true\n');
            writeFile(
                directory,
                'invalid-boolean.desktop',
                '[Desktop Entry]\nName=Broken Boolean\nHidden=maybe\n'
            );
            writeFile(directory, 'malformed.desktop', '[Desktop Entry\nName=Malformed\n');
            writeFile(directory, 'missing-group.desktop', '[Other]\nName=Not an entry\n');

            const result = readAutostartEntries(directory);
            expect(result.directoryError).toBeNull();
            expect(result.entries.length).toBe(2);
            expect(result.issues.length).toBe(3);
            expect(result.entries.find((entry) => entry.filePath === visible)?.enabled).toBe(true);
            expect(result.entries.find((entry) => entry.filePath.endsWith('hidden.desktop'))?.enabled).toBe(false);
            expect(result.entries.find((entry) => entry.filePath.endsWith('hidden.desktop'))?.name).toBe('hidden');
            expect(result.issues.every((issue) => issue.kind === 'invalid')).toBe(true);
        } finally {
            removeTempDirectory(directory);
        }
    });

    it('changes only Desktop Entry.Hidden and confirms both persisted states', () => {
        const directory = makeTempDirectory();
        try {
            const path = writeFile(
                directory,
                'editor.desktop',
                '# file comment\n[Desktop Entry]\n# name comment\nName=Editor\nName[fr]=Éditeur\nExec=editor\nX-Keep=retained\n\n[Other]\nHidden=true\nX-Other=untouched\n'
            );
            const initial = readAutostartEntries(directory).entries[0];
            if (initial === undefined) throw new Error('Expected a readable startup entry.');
            expect(initial.enabled).toBe(true);

            const disabled = setAutostartEnabled(initial, false);
            if (!disabled.ok) throw new Error(disabled.error);
            expect(disabled).toEqual({ok: true, enabled: false});
            expect(readAutostartEntries(directory).entries[0]?.enabled).toBe(false);

            const contents = DECODER.decode(Gio.File.new_for_path(path).load_contents(null)[1]);
            expect(contents.includes('# file comment')).toBe(true);
            expect(contents.includes('# name comment')).toBe(true);
            expect(contents.includes('Name=Editor')).toBe(true);
            expect(contents.includes('Name[fr]=Éditeur')).toBe(true);
            expect(contents.includes('Exec=editor')).toBe(true);
            expect(contents.includes('X-Keep=retained')).toBe(true);
            expect(contents.includes('[Other]')).toBe(true);
            expect(contents.includes('Hidden=true')).toBe(true);
            expect(contents.includes('X-Other=untouched')).toBe(true);

            const enabled = setAutostartEnabled({...initial, enabled: false}, true);
            expect(enabled).toEqual({ok: true, enabled: true});
            expect(readAutostartEntries(directory).entries[0]?.enabled).toBe(true);
        } finally {
            removeTempDirectory(directory);
        }
    });

    it('reports failed writes and an unreadable readback without claiming a save', () => {
        const directory = makeTempDirectory();
        try {
            const missingPath = GLib.build_filenamev([directory, 'missing.desktop']);
            const result = setAutostartEnabled(
                {name: 'Missing', enabled: true, filePath: missingPath},
                false
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.enabled).toBeNull();
                expect(result.error.length > 0).toBe(true);
            }
        } finally {
            removeTempDirectory(directory);
        }
    });
});

run(import.meta.url);
