/**
 * XDPH protocol parsing + hyprctl queries.
 *
 * Protocol:
 *   Env: XDPH_WINDOW_SHARING_LIST = "HANDLE[HC>]CLASS[HT>]TITLE[HE>]ADDR[HA>]..."
 *   Stdout: [SELECTION][r]/screen:NAME  or  [SELECTION][r]/window:ID
 */

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import type {HyprClient, HyprMonitor, ParsedWindowList} from './types';
import {parseWindowEntries} from './windowList';

const CAT = 'share-picker';

export const HYPRCTL_BIN = GLib.find_program_in_path('hyprctl') || 'hyprctl';

/** A stalled Hyprland IPC must not freeze the picker or hold a dialog open. */
const HYPRCTL_TIMEOUT_MS = 3000;

interface CommandResult {
    ok: boolean;
    out: string;
    err: string;
}

const runningQueries = new Map<Gio.Subprocess, number>();
let queriesStopped = false;

function runHyprctl(args: string[]): Promise<CommandResult> {
    if (queriesStopped)
        return Promise.resolve({ok: false, out: '', err: 'Picker is shutting down'});
    const {promise, resolve} = Promise.withResolvers<CommandResult>();
    let proc: Gio.Subprocess;
    try {
        proc = Gio.Subprocess.new(
            [HYPRCTL_BIN, ...args],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        resolve({ok: false, out: '', err: String(e)});
        return promise;
    }
    const watchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HYPRCTL_TIMEOUT_MS, () => {
        runningQueries.set(proc, 0);
        logger.warn(CAT, `hyprctl ${args.join(' ')} timed out`);
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    runningQueries.set(proc, watchdog);
    proc.communicate_utf8_async(null, null, (_proc, result) => {
        const timer = runningQueries.get(proc);
        if (timer) GLib.source_remove(timer);
        runningQueries.delete(proc);
        try {
            const [, out, err] = proc.communicate_utf8_finish(result);
            resolve({
                ok: proc.get_successful(),
                out: out?.trim() ?? '',
                err: err?.trim() ?? '',
            });
        } catch (e) {
            resolve({ok: false, out: '', err: String(e)});
        }
    });
    return promise;
}

/** Stop IPC children before shutdown can dispose the UI they were serving. */
export function stopQueries(): void {
    queriesStopped = true;
    for (const [proc, timer] of runningQueries) {
        if (timer) GLib.source_remove(timer);
        proc.force_exit();
        try {
            proc.wait(null);
        } catch (error) {
            logger.warn(CAT, 'waiting for hyprctl during shutdown failed', error);
        }
    }
    runningQueries.clear();
}

/**
 * Parse the XDPH_WINDOW_SHARING_LIST environment variable (wire format in
 * windowList.ts). The XDPH "id" is a toplevel handle, NOT a Hyprland client
 * address; `address` is the Hyprland address in hyprctl's 0x… form.
 * Titles are user content (documents, chats) and are never logged.
 */
export function parseWindowList(env: string | null): ParsedWindowList {
    if (env === null) {
        logger.info(CAT, 'XDPH_WINDOW_SHARING_LIST not set — no portal windows available');
        return {provided: false, windows: []};
    }
    const result = parseWindowEntries(env);
    logger.info(CAT, `parsed ${result.length} XDPH windows from XDPH_WINDOW_SHARING_LIST`);
    for (const w of result) {
        logger.debug(
            CAT,
            `  parsed XDPH window: id=${w.id} class=${w.clazz} addr=${w.address || 'none'}`
        );
    }
    return {provided: true, windows: result};
}

export async function getHyprMonitors(): Promise<HyprMonitor[]> {
    const {ok, out, err} = await runHyprctl(['-j', 'monitors']);
    logger.info(CAT, `hyprctl -j monitors ok=${ok} outLen=${out.length}`);
    if (err) logger.warn(CAT, `hyprctl monitors stderr: ${err.substring(0, 200)}`);
    if (!ok) {
        logger.warn(CAT, 'hyprctl monitors failed — are you running on Hyprland?');
        return [];
    }
    try {
        const raw: unknown = JSON.parse(out);
        if (!Array.isArray(raw)) {
            logger.warn(CAT, `getHyprMonitors not an array: ${typeof raw}`);
            return [];
        }
        type RawJson = Record<string, unknown>;
        const entries = raw as RawJson[];
        return entries.map((m) => {
            const name = typeof m.name === 'string' ? m.name : 'Unknown';
            let description = '';
            if (typeof m.description === 'string') description = m.description;
            else if (typeof m.name === 'string') description = m.name;
            return {
                name,
                description,
                x: typeof m.x === 'number' ? m.x : 0,
                y: typeof m.y === 'number' ? m.y : 0,
                width: typeof m.width === 'number' ? m.width : 0,
                height: typeof m.height === 'number' ? m.height : 0,
                transform: typeof m.transform === 'number' ? m.transform : 0,
            };
        });
    } catch (e) {
        logger.error(CAT, `getHyprMonitors: JSON parse failed. outLen=${out.length}`, e);
        return [];
    }
}

export async function getHyprClients(): Promise<HyprClient[]> {
    const {ok, out, err} = await runHyprctl(['-j', 'clients']);
    logger.info(CAT, `hyprctl -j clients ok=${ok} outLen=${out.length}`);
    if (err) logger.warn(CAT, `hyprctl clients stderr: ${err.substring(0, 200)}`);
    if (!ok) {
        logger.warn(CAT, 'hyprctl clients failed — window list will be empty');
        return [];
    }
    try {
        const raw: unknown = JSON.parse(out);
        if (!Array.isArray(raw)) {
            logger.warn(CAT, `getHyprClients not an array: ${typeof raw}`);
            return [];
        }
        type RawJson = Record<string, unknown>;
        const clients = raw as RawJson[];
        return clients.map((c) => ({
            address: c.address ?? '',
            class: c.class ?? c.initialClass ?? '',
            title: c.title ?? '',
            at: c.at ?? [0, 0],
            size: c.size ?? [0, 0],
            mapped: c.mapped ?? false,
            hidden: c.hidden ?? false,
        })) as HyprClient[];
    } catch (e) {
        logger.error(CAT, `getHyprClients: JSON parse failed. outLen=${out.length}`, e);
        return [];
    }
}
