import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {CompositorPort} from '../compositor/port';
import type {VirtualMonitor} from './types';
import {notify} from './utils';

const ICON_ERROR = 'dialog-error-symbolic';
const compositor = new CompositorPort();

/** Headless Hyprland outputs used for screen sharing and virtual cameras. */
export async function createVirtualMonitor(
    monitors: VirtualMonitor[],
    resolution = '1920x1080',
    fps = 60
): Promise<VirtualMonitor | null> {
    try {
        await compositor.createHeadlessOutput('SHADE-VMON');

        let name: string | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            const {all} = await compositor.displaySnapshot();
            const monitors = all.filter(
                (monitor): monitor is {name: string} =>
                    typeof monitor === 'object' &&
                    monitor !== null &&
                    !Array.isArray(monitor) &&
                    'name' in monitor &&
                    typeof monitor.name === 'string'
            );
            name =
                monitors.find((monitor) => monitor.name.startsWith('SHADE-VMON'))?.name ??
                monitors.find((monitor) => monitor.name.startsWith('HEADLESS'))?.name ??
                null;
            if (name) break;
            await new Promise<void>((resolve) =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                })
            );
        }

        if (!name) {
            logger.error('screenshot', 'failed to find created virtual monitor');
            notify('Virtual monitor', 'Hyprland did not register the headless output.', ICON_ERROR);
            return null;
        }

        await compositor.applyMonitor({
            name,
            resolution: `${resolution}@${fps}`,
            position: 'auto',
            scale: 1,
            transform: 0,
            vrr: null,
            disabled: false,
        });
        const virtualMonitor: VirtualMonitor = {name, resolution, fps};
        monitors.push(virtualMonitor);
        logger.info(
            'screenshot',
            `created virtual monitor: ${virtualMonitor.name} (${resolution}@${fps})`
        );
        return virtualMonitor;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('screenshot', `failed to create virtual monitor: ${message}`);
        notify('Virtual monitor', `Could not create virtual monitor: ${message}`, ICON_ERROR);
        return null;
    }
}

export async function removeVirtualMonitors(monitors: VirtualMonitor[]): Promise<void> {
    for (const monitor of monitors) {
        try {
            await compositor.removeOutput(monitor.name);
            logger.info('screenshot', `removed virtual monitor: ${monitor.name}`);
        } catch (error) {
            logger.warn(
                'screenshot',
                `failed to remove ${monitor.name}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    monitors.length = 0;
}
