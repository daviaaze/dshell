import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

export interface AutostartEntry {
    name: string;
    enabled: boolean;
    filePath: string;
}

export interface AutostartIssue {
    filePath: string;
    kind: 'read' | 'invalid';
    message: string;
}

export interface AutostartReadResult {
    entries: AutostartEntry[];
    issues: AutostartIssue[];
    directoryError: string | null;
}

type EntryReadResult =
    | {ok: true; entry: AutostartEntry; keyFile: GLib.KeyFile; etag: string | null}
    | {ok: false; issue: AutostartIssue};

const DESKTOP_ENTRY_GROUP = 'Desktop Entry';
const KEY_FILE_FLAGS = GLib.KeyFileFlags.KEEP_COMMENTS | GLib.KeyFileFlags.KEEP_TRANSLATIONS;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readEntry(filePath: string): EntryReadResult {
    let contents: Uint8Array;
    let etag: string | null;
    try {
        const [loaded, bytes, fileEtag] = Gio.File.new_for_path(filePath).load_contents(null);
        if (!loaded) throw new Error('The startup entry could not be read.');
        contents = bytes;
        etag = fileEtag;
    } catch (error) {
        return {ok: false, issue: {filePath, kind: 'read', message: errorMessage(error)}};
    }

    try {
        const keyFile = new GLib.KeyFile();
        if (!keyFile.load_from_bytes(new GLib.Bytes(contents), KEY_FILE_FLAGS)) {
            throw new Error('The startup entry could not be parsed.');
        }
        if (!keyFile.has_group(DESKTOP_ENTRY_GROUP)) {
            throw new Error('The startup entry has no [Desktop Entry] group.');
        }
        const [keys] = keyFile.get_keys(DESKTOP_ENTRY_GROUP);
        const enabled = !keys.includes('Hidden') || !keyFile.get_boolean(DESKTOP_ENTRY_GROUP, 'Hidden');
        const filename = GLib.path_get_basename(filePath).replace(/\.desktop$/, '');
        const name = keys.includes('Name')
            ? keyFile.get_locale_string(DESKTOP_ENTRY_GROUP, 'Name', null) || filename
            : filename;
        return {ok: true, entry: {name, enabled, filePath}, keyFile, etag};
    } catch (error) {
        return {ok: false, issue: {filePath, kind: 'invalid', message: errorMessage(error)}};
    }
}

/** Read user-provided startup entries without creating or repairing files or directories. */
export function readAutostartEntries(
    directory = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart'])
): AutostartReadResult {
    const result: AutostartReadResult = {entries: [], issues: [], directoryError: null};
    let enumerator: Gio.FileEnumerator;
    try {
        enumerator = Gio.File.new_for_path(directory).enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
    } catch (error) {
        if (
            !(
                error instanceof GLib.Error &&
                error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
            )
        ) {
            result.directoryError = errorMessage(error);
        }
        return result;
    }

    try {
        let info = enumerator.next_file(null);
        while (info !== null) {
            const filename = info.get_name();
            if (filename.endsWith('.desktop')) {
                const entry = readEntry(GLib.build_filenamev([directory, filename]));
                if (entry.ok) result.entries.push(entry.entry);
                else result.issues.push(entry.issue);
            }
            info = enumerator.next_file(null);
        }
    } catch (error) {
        result.directoryError = errorMessage(error);
    } finally {
        try {
            const closed = enumerator.close(null);
            if (!closed && result.directoryError === null) {
                result.directoryError = 'The startup directory read could not be closed.';
            }
        } catch (error) {
            if (result.directoryError === null) result.directoryError = errorMessage(error);
        }
    }
    result.entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
    result.issues.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return result;
}

/** Change only Desktop Entry.Hidden, and report the state actually read back from disk. */
export function setAutostartEnabled(
    entry: AutostartEntry,
    enabled: boolean
): {ok: true; enabled: boolean} | {ok: false; enabled: boolean | null; error: string} {
    const current = readEntry(entry.filePath);
    let writeError: string | null = null;
    if (current.ok) {
        try {
            current.keyFile.set_boolean(DESKTOP_ENTRY_GROUP, 'Hidden', !enabled);
            const [data] = current.keyFile.to_data();
            const [saved] = Gio.File.new_for_path(entry.filePath).replace_contents(
                new TextEncoder().encode(data),
                current.etag,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );
            if (!saved) throw new Error('The startup setting could not be saved.');
        } catch (error) {
            writeError = errorMessage(error);
        }
    } else {
        writeError = current.issue.message;
    }

    const actual = readEntry(entry.filePath);
    if (!actual.ok) {
        const readError = `The startup setting could not be confirmed: ${actual.issue.message}`;
        return {ok: false, enabled: null, error: writeError ? `${writeError}\n${readError}` : readError};
    }
    if (writeError !== null) return {ok: false, enabled: actual.entry.enabled, error: writeError};
    if (actual.entry.enabled !== enabled) {
        return {
            ok: false,
            enabled: actual.entry.enabled,
            error: 'The startup setting read back from disk did not match the requested value.',
        };
    }
    return {ok: true, enabled: actual.entry.enabled};
}
