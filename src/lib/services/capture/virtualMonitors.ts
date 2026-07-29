import GLib from 'gi://GLib?version=2.0';
import logger from '../../core/logger';
import {Process} from '../../core/process';
import {notify} from './utils';
import type {VirtualMonitor} from './types';

const ICON_ERROR = 'dialog-error-symbolic';

/**
 * Headless Hyprland outputs used for screen-sharing/virtual-camera workflows.
 * Extracted from the Screenshot service; state stays in Screenshot, these
 * functions do the hyprctl round-trips.
 */
export async function createVirtualMonitor(
    monitors: VirtualMonitor[],
    resolution = '1920x1080',
    fps = 60
): Promise<VirtualMonitor | null> {
    try {
        await Process.execAsync('hyprctl output create headless SHADE-VMON');

        let vmon: {name: string} | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            const all = JSON.parse(
                await Process.execAsync('hyprctl -j monitors all')
            );
            vmon =
                all.find((m: {name: string}) =>
                    m.name.startsWith('SHADE-VMON')
                ) ??
                all.find((m: {name: string}) =>
                    m.name.startsWith('HEADLESS')
                ) ??
                null;
            if (vmon) break;
            await new Promise<void>(resolve =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                })
            );
        }

        if (!vmon) {
            logger.error(
                'screenshot',
                'failed to find created virtual monitor'
            );
            notify(
                'Virtual monitor',
                'Hyprland did not register the headless output.',
                ICON_ERROR
            );
            return null;
        }

        await Process.execAsync(
            `hyprctl keyword monitor ${vmon.name},${resolution}@${fps},auto-right,1`
        );
        const vm: VirtualMonitor = {name: vmon.name, resolution, fps};
        monitors.push(vm);
        logger.info(
            'screenshot',
            `created virtual monitor: ${vm.name} (${resolution}@${fps})`
        );
        return vm;
    } catch (e) {
        logger.error(
            'screenshot',
            `failed to create virtual monitor: ${e instanceof Error ? e.message : String(e)}`
        );
        notify(
            'Virtual monitor',
            `Could not create virtual monitor: ${e instanceof Error ? e.message : String(e)}`,
            ICON_ERROR
        );
        return null;
    }
}

export function removeVirtualMonitors(monitors: VirtualMonitor[]): void {
    for (const vm of monitors) {
        try {
            Process.exec(`hyprctl output remove ${vm.name}`);
            logger.info('screenshot', `removed virtual monitor: ${vm.name}`);
        } catch (e) {
            logger.warn(
                'screenshot',
                `failed to remove ${vm.name}: ${e instanceof Error ? e.message : String(e)}`
            );
        }
    }
    monitors.length = 0;
}
