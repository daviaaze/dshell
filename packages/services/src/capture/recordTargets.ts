import {publishCapture} from './utils';
import logger from '@shade/core/logger';
import {bus} from '../bus';
import {
    getHyprland,
    getHyprlandClientSnapshot,
    normalizeHyprlandAddress,
    type HyprlandClientSnapshot,
} from '../hyprland';
import type {BoundaryGeometry, ScreenshotHandle} from './types';
import {slurpAreaRecording, useSlurpForSelection} from './captureFlow';
import {notify} from './utils';

const ICON_ERROR = 'dialog-error-symbolic';
const MSG_RECORDING_FAILED = 'Recording failed';

/**
 * "Record X" entry points — resolve a target (area/output/window) into either
 * an overlay selection flow or a direct recorder start.
 *
 * Geometry is typed end-to-end; grim strings are produced inside Recorder
 * at the process boundary.
 */

function clientGeometry(c: {
    x: number;
    y: number;
    width: number;
    height: number;
}): BoundaryGeometry {
    return {x: c.x, y: c.y, width: c.width, height: c.height};
}

export function recordArea(ss: ScreenshotHandle) {
    if (ss.recording) return;
    if (useSlurpForSelection()) {
        publishCapture({state: 'busy', kind: 'recording'});
        slurpAreaRecording(ss);
        return;
    }
    ss.selectedMode = 'recording';
    ss.selectedTarget = 'area';
    ss.overlayQuick = true;
    ss.overlayOpen = true;
}

export function recordOutput(ss: ScreenshotHandle, outputName?: string) {
    if (ss.recording) return;
    if (!outputName) {
        const hyprland = getHyprland();
        if (!hyprland) return;
        outputName = hyprland.focusedMonitor?.name;
        logger.info('screenshot', `focused monitor name: ${outputName}`);
    }
    if (!outputName) {
        logger.error('screenshot', 'no output name, cannot record output');
        notify(MSG_RECORDING_FAILED, 'No monitor found', ICON_ERROR);
        return;
    }
    ss.startRecording({output: outputName});
    bus.emit('capture:record:output');
}

export function recordOutputVisual(ss: ScreenshotHandle) {
    if (ss.recording) return;
    ss.selectedMode = 'recording';
    ss.selectedTarget = 'monitor';
    ss.overlayQuick = false;
    ss.overlayOpen = true;
}

export function recordWindowVisual(ss: ScreenshotHandle) {
    if (ss.recording) return;
    ss.selectedMode = 'recording';
    ss.selectedTarget = 'window';
    ss.overlayQuick = false;
    ss.overlayOpen = true;
}

export function recordWindowByAddress(ss: ScreenshotHandle, address: string) {
    if (ss.recording) return;
    const hyprland = getHyprland();
    if (!hyprland) return;
    let target: HyprlandClientSnapshot | undefined;
    try {
        target = getHyprlandClientSnapshot().find(
            (client) => client.address === normalizeHyprlandAddress(address)
        );
    } catch (error) {
        logger.error('screenshot', `failed to query window geometry: ${error}`);
        notify(MSG_RECORDING_FAILED, 'Window geometry unavailable', ICON_ERROR);
        return;
    }
    if (!target) {
        logger.error('screenshot', `window with address ${address} not found`);
        notify(MSG_RECORDING_FAILED, 'Window not found', ICON_ERROR);
        return;
    }
    const geometry = clientGeometry(target);
    logger.debug('screenshot', `window geometry: ${toLog(geometry)}`);
    ss.startRecording({geometry});
    bus.emit('capture:record:window');
}

export function recordWindow(ss: ScreenshotHandle) {
    if (ss.recording) return;
    const hyprland = getHyprland();
    if (!hyprland) return;
    let target: HyprlandClientSnapshot | undefined;
    let focusedAddress: string | undefined;
    try {
        const focused = JSON.parse(hyprland.message('j/activewindow')) as {address?: string};
        focusedAddress = focused.address;
        if (focusedAddress) {
            const address = normalizeHyprlandAddress(focusedAddress);
            target = getHyprlandClientSnapshot().find((client) => client.address === address);
        }
    } catch (error) {
        logger.error('screenshot', `failed to query focused window geometry: ${error}`);
        notify(MSG_RECORDING_FAILED, 'Window geometry unavailable', ICON_ERROR);
        return;
    }
    if (!focusedAddress) {
        logger.error('screenshot', 'no focused client, cannot record window');
        notify(MSG_RECORDING_FAILED, 'No window focused', ICON_ERROR);
        return;
    }
    if (!target) {
        logger.error('screenshot', `focused window ${focusedAddress} not found`);
        notify(MSG_RECORDING_FAILED, 'Window not found', ICON_ERROR);
        return;
    }
    const geometry = clientGeometry(target);
    logger.debug('screenshot', `window geometry: ${toLog(geometry)}`);
    ss.startRecording({geometry});
    bus.emit('capture:record:window');
}

function toLog(g: BoundaryGeometry): string {
    return `${g.x},${g.y} ${g.width}x${g.height}`;
}
