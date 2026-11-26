import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {CompositorPort} from '../compositor/port';
import type {VirtualMonitor} from './types';
import {notify} from './utils';

const ICON_ERROR = 'dialog-error-symbolic';
const compositor = new CompositorPort();
const ownedOutputs = new Map<string, boolean>(); // false until configuration succeeds
let operations: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operations.then(operation);
    operations = result.then(
        () => {},
        () => {}
    );
    return result;
}

function hasOutput(outputs: unknown[], name: string): boolean {
    return outputs.some(
        (output) =>
            typeof output === 'object' &&
            output !== null &&
            'name' in output &&
            output.name === name
    );
}

async function removeOwnedMonitor(
    monitors: VirtualMonitor[],
    monitor: VirtualMonitor
): Promise<void> {
    if (!ownedOutputs.has(monitor.name)) return;
    await compositor.removeOutput(monitor.name);
    ownedOutputs.delete(monitor.name);
    const index = monitors.indexOf(monitor);
    if (index >= 0) monitors.splice(index, 1);
    logger.info('screenshot', `removed virtual monitor: ${monitor.name}`);
}

/** Headless Hyprland outputs used for screen sharing and virtual cameras. */
export async function createVirtualMonitor(
    monitors: VirtualMonitor[],
    resolution = '1920x1080',
    fps = 60
): Promise<VirtualMonitor | null> {
    return serialize(async () => {
        const existing = monitors.find((monitor) => ownedOutputs.has(monitor.name));
        if (existing) return ownedOutputs.get(existing.name) ? existing : null;
        const name = `SHADE-VMON-${GLib.uuid_string_random()}`;
        const monitor: VirtualMonitor = {name, resolution, fps};
        let tracked = false;
        try {
            if (hasOutput((await compositor.displaySnapshot()).all, name)) {
                throw new Error('The requested virtual output already exists');
            }
            // Track the exact requested name before any creation await, so a
            // partial failure cannot lose our rollback/cleanup handle.
            ownedOutputs.set(name, false);
            monitors.push(monitor);
            tracked = true;
            await compositor.createHeadlessOutput(name);

            let found = false;
            for (let attempt = 0; attempt < 10; attempt++) {
                if (hasOutput((await compositor.displaySnapshot()).all, name)) {
                    found = true;
                    break;
                }
                const {promise, resolve} = Promise.withResolvers<void>();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
                await promise;
            }
            if (!found) throw new Error('Hyprland did not register the requested headless output');

            await compositor.applyMonitor({
                name,
                resolution: `${resolution}@${fps}`,
                position: 'auto',
                scale: 1,
                transform: 0,
                vrr: null,
                disabled: false,
            });
            ownedOutputs.set(name, true);
            logger.info('screenshot', `created virtual monitor: ${name} (${resolution}@${fps})`);
            return monitor;
        } catch (error) {
            if (tracked) {
                try {
                    await removeOwnedMonitor(monitors, monitor);
                } catch (cleanupError) {
                    logger.warn('screenshot', `could not roll back ${name}: ${cleanupError}`);
                }
            }
            const message = error instanceof Error ? error.message : String(error);
            logger.error('screenshot', `failed to create virtual monitor: ${message}`);
            notify('Virtual monitor', `Could not create virtual monitor: ${message}`, ICON_ERROR);
            return null;
        }
    });
}

export async function removeVirtualMonitors(monitors: VirtualMonitor[]): Promise<void> {
    return serialize(async () => {
        for (const monitor of [...monitors]) {
            try {
                await removeOwnedMonitor(monitors, monitor);
            } catch (error) {
                // Retain ownership and the list entry so cleanup can be retried.
                logger.warn(
                    'screenshot',
                    `failed to remove ${monitor.name}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    });
}
