/**
 * Pure parser for XDPH_WINDOW_SHARING_LIST (no GI imports, unit-testable).
 *
 * Current XDPH entry:  HANDLE[HC>]CLASS[HT>]TITLE[HE>]ADDR[HA>]
 *   - HANDLE: uint32 toplevel handle. This is the ONLY value XDPH accepts back
 *     in `[SELECTION]/window:<HANDLE>`; anything else makes it answer
 *     "selection -1" and the share silently dies.
 *   - ADDR:   Hyprland window address as a decimal uint64 ("0" when unmapped).
 *     hyprctl prints it as 0x<hex>, so it is normalised for matching.
 *   - `[HA>]` terminates an entry and `[HE>]` separates TITLE from ADDR.
 *
 * Legacy XDPH (no `[HA>]` anywhere): HANDLE[HC>]CLASS[HT>]TITLE[HE>] per entry.
 *
 * Splitting a current list on `[HE>]` (the legacy rule) glues the previous
 * entry's ADDR onto the next entry's HANDLE, so every window but the first
 * came back as "ADDR[HA>]HANDLE" and was rejected by XDPH.
 */

import type {XDPHWindow} from './types';

/** XDPH decimal address -> hyprctl `0x…` form; '' when absent, zero or malformed. */
export function normalizeAddress(raw: string): string {
    if (!/^\d+$/.test(raw)) return '';
    const value = BigInt(raw);
    return value === 0n ? '' : `0x${value.toString(16)}`;
}

function parseEntry(entry: string, addrRaw: string): XDPHWindow | null {
    const idSep = entry.indexOf('[HC>]');
    if (idSep === -1) return null;
    const classSep = entry.indexOf('[HT>]', idSep);
    if (classSep === -1) return null;

    const id = entry.substring(0, idSep);
    if (!/^\d+$/.test(id)) return null;

    return {
        id,
        clazz: entry.substring(idSep + 5, classSep),
        title: entry.substring(classSep + 5),
        address: normalizeAddress(addrRaw),
    };
}

export function parseWindowEntries(env: string): XDPHWindow[] {
    const windows: XDPHWindow[] = [];

    if (env.includes('[HA>]')) {
        for (const raw of env.split('[HA>]')) {
            if (raw.trim().length === 0) continue;
            const endSep = raw.lastIndexOf('[HE>]');
            const body = endSep === -1 ? raw : raw.substring(0, endSep);
            const addr = endSep === -1 ? '' : raw.substring(endSep + 5);
            const win = parseEntry(body, addr);
            if (win) windows.push(win);
        }
        return windows;
    }

    for (const raw of env.split('[HE>]')) {
        if (raw.trim().length === 0) continue;
        const win = parseEntry(raw, '');
        if (win) windows.push(win);
    }
    return windows;
}
