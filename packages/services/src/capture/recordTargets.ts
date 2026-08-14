import logger from '@shade/core/logger';
import {bus} from '../bus';
import {getHyprland} from '../hyprland';
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
    const clients = hyprland.clients || [];
    const target = clients.find((c) => c.address === address);
    if (!target) {
        logger.error('screenshot', `window with address ${address} not found`);
        notify(MSG_RECORDING_FAILED, 'Window not found', ICON_ERROR);
        return;
    }
    logger.debug('screenshot', `window geometry: ${toLog(clientGeometry(target))}`);
    ss.startRecording({geometry: clientGeometry(target)});
    bus.emit('capture:record:window');
}

export function recordWindow(ss: ScreenshotHandle) {
    if (ss.recording) return;
    const hyprland = getHyprland();
    if (!hyprland) return;
    const client = hyprland.focusedClient;
    if (!client) {
        logger.error('screenshot', 'no focused client, cannot record window');
        notify(MSG_RECORDING_FAILED, 'No window focused', ICON_ERROR);
        return;
    }
    logger.debug('screenshot', `window geometry: ${toLog(clientGeometry(client))}`);
    ss.startRecording({geometry: clientGeometry(client)});
    bus.emit('capture:record:window');
}

function toLog(g: BoundaryGeometry): string {
    return `${g.x},${g.y} ${g.width}x${g.height}`;
}
