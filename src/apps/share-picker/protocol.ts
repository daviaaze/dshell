/**
 * XDPH protocol parsing + hyprctl queries.
 *
 * Protocol:
 *   Env: XDPH_WINDOW_SHARING_LIST = "ID[HC>]CLASS[HT>]TITLE[HE>]..."
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '#/lib/core/logger';
import type {HyprClient, HyprMonitor, XDPHWindow} from './types';

const CAT = 'share-picker';

export const HYPRCTL_BIN = GLib.find_program_in_path('hyprctl') || 'hyprctl';

function runSync(cmd: string[]): {ok: boolean; out: string; err: string} {
    try {
        const proc = Gio.Subprocess.new(
            cmd,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [, out, err] = proc.communicate_utf8(null, null);
        return {ok: proc.get_successful(), out: out?.trim() ?? '', err: err?.trim() ?? ''};
    } catch (e) {
        return {ok: false, out: '', err: String(e)};
    }
}

/**
 * Parse the XDPH_WINDOW_SHARING_LIST environment variable.
 *
 * Actual format: ID[HC>]CLASS[HT>]TITLE[HE>]ID[HC>]CLASS[HT>]TITLE[HE>]...
 *   - [HE>] is the entry delimiter (Handle End)
 *   - [HC>] separates ID from CLASS (Handle Class)
 *   - [HT>] separates CLASS from TITLE (Handle Title)
 *   - [HA>] (optional, newer XDPH) separates TITLE from ADDR (Handle Address)
 *   - The XDPH "id" is a wayland object handle serial, NOT a Hyprland client address
 */
export function parseWindowList(env: string | null): XDPHWindow[] {
    if (!env) return [];
    const result: XDPHWindow[] = [];

    const entries = env.split('[HE>]').filter(e => e.trim().length > 0);

    for (const entry of entries) {
        const idSep = entry.indexOf('[HC>]');
        if (idSep === -1) continue;
        const id = entry.substring(0, idSep);

        const classSep = entry.indexOf('[HT>]', idSep);
        if (classSep === -1) continue;
        const clazz = entry.substring(idSep + 5, classSep);

        // Title goes from [HT>] to end of entry (or [HA>] if present)
        const addrSep = entry.indexOf('[HA>]', classSep);
        const titleEnd = addrSep !== -1 ? addrSep : entry.length;
        const title = entry.substring(classSep + 5, titleEnd);

        let address = '';
        if (addrSep !== -1) {
            address = entry.substring(addrSep + 5);
        }

        result.push({id, clazz, title, address});
    }

    return result;
}

export function getHyprMonitors(): HyprMonitor[] {
    const {ok, out, err} = runSync([HYPRCTL_BIN, '-j', 'monitors']);
    logger.debug(CAT, `getHyprMonitors ok=${ok} outLen=${out.length} err=${err}`);
    if (!ok) return [];
    try {
        const raw: unknown = JSON.parse(out);
        if (!Array.isArray(raw)) {
            logger.warn(CAT, `getHyprMonitors not an array: ${typeof raw}`);
            return [];
        }
        type RawJson = Record<string, unknown>;
        const entries = raw as RawJson[];
        return entries.map(m => ({
            name: m.name ?? 'Unknown',
            description: m.description ?? m.name ?? '',
            x: m.x ?? 0,
            y: m.y ?? 0,
            width: m.width ?? 0,
            height: m.height ?? 0,
        })) as HyprMonitor[];
    } catch (e) {
        logger.error(CAT, `getHyprMonitors: JSON parse failed. out=${out.substring(0, 200)}`, e);
        return [];
    }
}

export function getHyprClients(): HyprClient[] {
    const {ok, out, err} = runSync([HYPRCTL_BIN, '-j', 'clients']);
    logger.debug(CAT, `getHyprClients ok=${ok} outLen=${out.length} err=${err}`);
    if (!ok) return [];
    try {
        const raw: unknown = JSON.parse(out);
        if (!Array.isArray(raw)) {
            logger.warn(CAT, `getHyprClients not an array: ${typeof raw}`);
            return [];
        }
        type RawJson = Record<string, unknown>;
        const clients = raw as RawJson[];
        return clients.map(c => ({
            address: c.address ?? '',
            class: c.class ?? c.initialClass ?? '',
            title: c.title ?? '',
            at: c.at ?? [0, 0],
            size: c.size ?? [0, 0],
            mapped: c.mapped ?? false,
            hidden: c.hidden ?? false,
        })) as HyprClient[];
    } catch (e) {
        logger.error(CAT, `getHyprClients: JSON parse failed. out=${out.substring(0, 200)}`, e);
        return [];
    }
}

/**
 * Match an XDPH window to a hyprctl client.
 * Priority: 1) address match (if XDPH provides [HA>]), 2) class+title fuzzy match.
 */
export function matchXDPHToHyprctl(xdphWin: XDPHWindow, clients: HyprClient[]): HyprClient | null {
    // Direct address match (only works if XDPH provides [HA>])
    if (xdphWin.address) {
        const byAddr = clients.find(c => c.address === xdphWin.address);
        if (byAddr) return byAddr;
    }

    // Fallback: match by class + title
    if (!xdphWin.clazz) return null;

    const candidates = clients.filter(c =>
        c.mapped &&
        !c.hidden &&
        c.class.toLowerCase() === xdphWin.clazz.toLowerCase()
    );

    const first = candidates[0];
    if (!first) return null;
    if (candidates.length === 1) return first;

    // Multiple windows with same class — match by title
    const xdphTitle = xdphWin.title.toLowerCase();
    const byTitle = candidates.find(c => c.title.toLowerCase() === xdphTitle);
    if (byTitle) return byTitle;

    // Title prefix match
    const byPrefix = candidates.find(c =>
        c.title.toLowerCase().startsWith(xdphTitle) ||
        xdphTitle.startsWith(c.title.toLowerCase())
    );
    if (byPrefix) return byPrefix;

    // Return first mapped candidate as last resort
    return first;
}
