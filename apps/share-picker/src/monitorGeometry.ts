import type {HyprMonitor} from './types';

/** Hyprland reports mode dimensions before applying quarter-turn transforms. */
export function monitorResolution(monitor: Pick<HyprMonitor, 'width' | 'height' | 'transform'>) {
    const transform = Number.isFinite(monitor.transform) ? Math.abs(monitor.transform ?? 0) : 0;
    return transform % 2 === 1
        ? {width: monitor.height, height: monitor.width}
        : {width: monitor.width, height: monitor.height};
}
