/**
 * Builds the share-source states by querying Hyprland and matching
 * XDPH windows to client metadata and exact native capture identities.
 */
import logger from '@shade/core/logger';
import {getWindowCaptureId, matchXDPHToHyprctl} from './clientMatch';
import {getHyprClients, getHyprMonitors} from './protocol';
import type {MonitorState, WindowState, XDPHWindow} from './types';

const CAT = 'share-picker';

export interface Sources {
    monitors: MonitorState[];
    windows: WindowState[];
    matched: number;
}

export async function buildSources(xdphWindows: XDPHWindow[]): Promise<Sources> {
    const [hyprMonitors, hyprClients] = await Promise.all([getHyprMonitors(), getHyprClients()]);
    logger.info(
        CAT,
        `${hyprMonitors.length} monitors, ${hyprClients.length} hyprctl clients, ` +
            `${xdphWindows.length} XDPH windows`
    );

    const monitors: MonitorState[] = hyprMonitors.map((m) => ({
        kind: 'monitor' as const,
        info: m,
        texture: null,
        capturing: false,
    }));

    let matched = 0;
    const windows: WindowState[] = xdphWindows.map((w) => {
        const client = matchXDPHToHyprctl(w, hyprClients);
        if (!client) {
            logger.debug(CAT, `no match for XDPH window id=${w.id} class=${w.clazz}`);
            return {
                kind: 'window' as const,
                info: w,
                geometry: null,
                hyprAddress: null,
                hyprStableId: null,
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
            hyprStableId: getWindowCaptureId(w, hyprClients),
            texture: null,
            capturing: false,
        };
    });
    logger.info(CAT, `matched ${matched}/${xdphWindows.length} XDPH windows to hyprctl clients`);

    return {monitors, windows, matched};
}
