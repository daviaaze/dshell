import logger from '@shade/core/logger';
import {CompositorPort} from '../compositor/port';

export interface WindowGeometry {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

const compositor = new CompositorPort();

/** Query mapped Hyprland windows for the region-selector overlay. */
export function getWindowGeometries(): WindowGeometry[] {
    try {
        const windows: WindowGeometry[] = [];
        for (const value of compositor.clientSnapshotSync()) {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
            if (
                !('mapped' in value) ||
                value.mapped !== true ||
                !('monitor' in value) ||
                typeof value.monitor !== 'number' ||
                value.monitor < 0 ||
                !('at' in value) ||
                !Array.isArray(value.at) ||
                typeof value.at[0] !== 'number' ||
                typeof value.at[1] !== 'number' ||
                !('size' in value) ||
                !Array.isArray(value.size) ||
                typeof value.size[0] !== 'number' ||
                typeof value.size[1] !== 'number' ||
                !('address' in value) ||
                typeof value.address !== 'string'
            )
                continue;
            windows.push({
                address: value.address,
                x: value.at[0],
                y: value.at[1],
                width: value.size[0],
                height: value.size[1],
                title:
                    'title' in value && typeof value.title === 'string'
                        ? value.title
                        : '(untitled)',
            });
        }
        return windows;
    } catch (error) {
        logger.warn('windows', 'failed to load windows:', error);
        return [];
    }
}
