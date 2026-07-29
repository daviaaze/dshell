import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {getHyprland} from '../../hyprland';
import logger from '../../core/logger';
import {notify} from './utils';
import type Screenshot from './screenshot';

const ICON_ERROR = 'dialog-error-symbolic';
const MSG_RECORDING_FAILED = 'Recording failed';

/**
 * "Record X" entry points — resolve a target (area/output/window) into either
 * an overlay selection flow or a direct recorder start.
 *
 * Extracted from the Screenshot service to keep it under the size budget;
 * each function takes the service instance and drives its public API.
 */
export function recordArea(ss: Screenshot) {
    if (ss.recording) return;
    ss.openRegionSelectorForCapture('recording');
}

export function recordOutput(ss: Screenshot, outputName?: string) {
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
}

export function recordOutputVisual(ss: Screenshot) {
    if (ss.recording) return;
    ss.selectedMode = 'recording';
    ss.selectedTarget = 'monitor';
    ss.overlayOpen = true;
}

export function recordWindowVisual(ss: Screenshot) {
    if (ss.recording) return;
    ss.selectedMode = 'recording';
    ss.selectedTarget = 'window';
    ss.overlayOpen = true;
}

export function recordWindowByAddress(ss: Screenshot, address: string) {
    if (ss.recording) return;
    const hyprland = getHyprland();
    if (!hyprland) return;
    const clients = hyprland.clients || [];
    const target = clients.find(c => c.address === address);
    if (!target) {
        logger.error('screenshot', `window with address ${address} not found`);
        notify(MSG_RECORDING_FAILED, 'Window not found', ICON_ERROR);
        return;
    }
    const geometry = `${target.x},${target.y} ${target.width}x${target.height}`;
    logger.debug('screenshot', `window geometry: ${geometry}`);
    ss.startRecording({geometry});
}

export function recordWindow(ss: Screenshot) {
    if (ss.recording) return;
    const hyprland = getHyprland();
    if (!hyprland) return;
    const client = hyprland.focusedClient;
    if (!client) {
        logger.error('screenshot', 'no focused client, cannot record window');
        notify(MSG_RECORDING_FAILED, 'No window focused', ICON_ERROR);
        return;
    }
    const geometry = `${client.x},${client.y} ${client.width}x${client.height}`;
    logger.debug('screenshot', `window geometry: ${geometry}`);
    ss.startRecording({geometry});
}
