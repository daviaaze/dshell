/**
 * Pairing of an XDPH window with its Hyprland client (pure, no GI).
 */

import type {HyprClient, XDPHWindow} from './types';

/**
 * Match an XDPH window to a hyprctl client.
 *
 * Priority: 1) live address match (if XDPH provides [HA>]), 2) class + unique exact title.
 * This match supplies metadata and selection checks only; pixel captures must
 * use getWindowCaptureId, which never falls back to a title or class.
 */
export function matchXDPHToHyprctl(xdphWin: XDPHWindow, clients: HyprClient[]): HyprClient | null {
    if (xdphWin.address) {
        const byAddr = clients.find((client) => client.address === xdphWin.address);
        if (byAddr) return byAddr.mapped && !byAddr.hidden ? byAddr : null;
    }

    if (!xdphWin.clazz || !xdphWin.title) return null;
    const clazz = xdphWin.clazz.toLowerCase();
    let match: HyprClient | null = null;
    for (const client of clients) {
        if (
            !client.mapped ||
            client.hidden ||
            client.class.toLowerCase() !== clazz ||
            client.title !== xdphWin.title
        )
            continue;
        if (match !== null) return null;
        match = client;
    }
    return match;
}

/**
 * Resolve pixels only through the portal's exact address and the current
 * compositor's opaque foreign-toplevel ID. Never derive it from an address,
 * title, class, or numeric conversion.
 */
export function getWindowCaptureId(
    xdphWin: XDPHWindow,
    clients: readonly HyprClient[]
): string | null {
    if (!xdphWin.address) return null;
    const client = clients.find((item) => item.address === xdphWin.address);
    if (!client?.mapped || client.hidden) return null;
    const stableId = client.stableId;
    return typeof stableId === 'string' &&
        stableId.length > 0 &&
        stableId.length <= 32 &&
        !/[^\x20-\x7e]/.test(stableId)
        ? stableId
        : null;
}
