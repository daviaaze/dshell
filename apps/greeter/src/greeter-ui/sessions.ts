/**
 * Session discovery for the greeter session picker.
 *
 * Scans wayland-sessions and xsessions desktop files across XDG data dirs
 * (first occurrence of a desktop file name wins, mirroring XDG precedence).
 */
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '@shade/core/logger';

export interface SessionEntry {
    /** Desktop file basename, e.g. "hyprland-uwsm.desktop" */
    id: string;
    /** Display name from the desktop file */
    name: string;
    /** Parsed Exec line as argv, with field codes (%U etc.) stripped */
    command: string[];
}

const SESSION_DIRS = ['wayland-sessions', 'xsessions'];
const FIELD_CODES = /%[a-zA-Z%]/g;

/** Parse a desktop-file Exec line into argv, stripping field codes. */
export function parseExec(exec: string): string[] {
    const cleaned = exec
        .replace(FIELD_CODES, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return [];
    try {
        const [ok, argv] = GLib.shell_parse_argv(cleaned);
        if (ok && argv && argv.length > 0) return argv;
    } catch (e) {
        logger.warn('greeter', `shell_parse_argv failed for "${cleaned}": ${e}`);
    }
    return cleaned.split(' ');
}

/** Read a desktop file, returning null if unusable. */
function readDesktopFile(path: string): {name: string; exec: string} | null {
    try {
        const kf = new GLib.KeyFile();
        kf.load_from_file(path, GLib.KeyFileFlags.NONE);
        const bool = (key: string): boolean => {
            try {
                return kf.get_boolean('Desktop Entry', key);
            } catch {
                return false;
            }
        };
        if (bool('NoDisplay') || bool('Hidden')) return null;
        const name = kf.get_string('Desktop Entry', 'Name');
        const exec = kf.get_string('Desktop Entry', 'Exec');
        if (!name || !exec) return null;
        return {name, exec};
    } catch {
        return null;
    }
}

/**
 * Discover available login sessions.
 * @param dataDirs override for testing; defaults to XDG system data dirs
 *                 plus $XDG_DATA_DIRS.
 */
export function discoverSessions(dataDirs?: string[]): SessionEntry[] {
    const dirs =
        dataDirs ??
        [
            ...GLib.get_system_data_dirs(),
            ...(GLib.getenv('XDG_DATA_DIRS')?.split(':') ?? []),
        ];

    const seen = new Set<string>();
    const sessions: SessionEntry[] = [];

    for (const base of dirs) {
        for (const sub of SESSION_DIRS) {
            const dirPath = `${base}/${sub}`;
            let enumerator: Gio.FileEnumerator;
            try {
                enumerator = Gio.File.new_for_path(dirPath).enumerate_children(
                    'standard::name',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
            } catch {
                continue; // dir doesn't exist or is unreadable
            }
            let info: Gio.FileInfo | null;
            while ((info = enumerator.next_file(null)) !== null) {
                const fileName = info.get_name();
                if (!fileName.endsWith('.desktop') || seen.has(fileName))
                    continue;
                seen.add(fileName);
                const entry = readDesktopFile(`${dirPath}/${fileName}`);
                if (!entry) continue;
                const command = parseExec(entry.exec);
                if (command.length === 0) continue;
                sessions.push({id: fileName, name: entry.name, command});
            }
        }
    }
    return sessions;
}

/**
 * Build the picker's session list: the SHADE_SESSION_COMMAND env var
 * (set by the NixOS module's cage wrapper) as the default first entry,
 * followed by all discovered sessions.
 */
export function buildSessionList(): SessionEntry[] {
    const entries: SessionEntry[] = [];
    const envCmd = GLib.getenv('SHADE_SESSION_COMMAND');
    if (envCmd?.trim()) {
        entries.push({
            id: 'default',
            name: 'Default Session',
            command: parseExec(envCmd),
        });
    }
    entries.push(...discoverSessions());
    if (entries.length === 0) {
        // Last-resort fallback so login can never dead-end
        entries.push({id: 'fallback', name: 'Hyprland', command: ['Hyprland']});
    }
    return entries;
}
