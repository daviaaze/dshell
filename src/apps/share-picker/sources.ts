/**
 * Builds the share-source states by querying Hyprland and matching
 * XDPH windows to hyprctl client geometries.
 */
import logger from '#/lib/core/logger';
import type {MonitorState, WindowState, XDPHWindow} from './types';
import {getHyprMonitors, getHyprClients, matchXDPHToHyprctl} from './protocol';

const CAT = 'share-picker';

export interface Sources {
    monitors: MonitorState[];
    windows: WindowState[];
    matched: number;
}

export function buildSources(xdphWindows: XDPHWindow[]): Sources {
    const hyprMonitors = getHyprMonitors();
    const hyprClients = getHyprClients();
    logger.info(
        CAT,
        `${hyprMonitors.length} monitors, ${hyprClients.length} hyprctl clients, ` +
            `${xdphWindows.length} XDPH windows`
    );

    const monitors: MonitorState[] = hyprMonitors.map(m => ({
        kind: 'monitor' as const,
        info: m,
        texture: null,
        capturing: false,
    }));

    let matched = 0;
    const windows: WindowState[] = xdphWindows.map(w => {
        const client = matchXDPHToHyprctl(w, hyprClients);
        if (!client) {
            logger.debug(
                CAT,
                `no match for XDPH window id=${w.id} class=${w.clazz} title=${w.title}`
            );
            return {
                kind: 'window' as const,
                info: w,
                geometry: null,
                hyprAddress: null,
                texture: null,
                capturing: false,
            };
        }
        matched++;
        return {
            kind: 'window' as const,
            info: w,
            geometry: {
                x: client.at[0],
                y: client.at[1],
                width: client.size[0],
                height: client.size[1],
            },
            hyprAddress: client.address,
            texture: null,
            capturing: false,
        };
    });
    logger.info(
        CAT,
        `matched ${matched}/${xdphWindows.length} XDPH windows to hyprctl clients`
    );

    return {monitors, windows, matched};
}
