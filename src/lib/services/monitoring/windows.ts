import {Process} from '../../core/process';
import logger from '../../core/logger';

export interface WindowGeometry {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

interface HyprctlClient {
    mapped: boolean;
    monitor: number;
    at: [number, number];
    size: [number, number];
    address: string;
    title: string;
    [key: string]: unknown;
}

/**
 * Query all mapped Hyprland windows via `hyprctl clients -j`.
 * Returns geometry data for the region selector overlay.
 * Encapsulates the shell command so widgets don't import Process.
 */
export function getWindowGeometries(): WindowGeometry[] {
    try {
        const json = Process.exec('hyprctl clients -j');
        const clients = JSON.parse(json) as HyprctlClient[];
        const windows: WindowGeometry[] = [];
        for (const c of clients) {
            if (c.mapped && c.monitor >= 0 && c.at && c.size) {
                windows.push({
                    address: c.address,
                    x: c.at[0],
                    y: c.at[1],
                    width: c.size[0],
                    height: c.size[1],
                    title: c.title || '(untitled)',
                });
            }
        }
        return windows;
    } catch (e) {
        logger.warn('windows', 'failed to load windows:', e);
        return [];
    }
}
