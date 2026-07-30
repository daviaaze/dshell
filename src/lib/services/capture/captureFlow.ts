import GLib from 'gi://GLib?version=2.0';
import logger from '../../core/logger';
import {bus} from '../../core/eventBus';
import {Process} from '../../core/process';
import {
    ensureScreenshotDir,
    notify,
    copyImageToClipboard,
    GRIM_BIN,
} from './utils';
import {grimToMagickGeometry, screenshotGeometry} from './stage';
import type Screenshot from './screenshot';

/**
 * Capture flows — fullscreen/area screenshot entry points and the
 * region-selector confirm path. Extracted from the Screenshot service;
 * each function drives the service's public API.
 *
 * Instead of a fixed delay for overlay close (which causes races on
 * slow hardware), capture uses `GLib.idle_add` which runs after all
 * pending GTK events (including widget unmap) are processed.
 */

export function screenshot(ss: Screenshot, fullscreen: boolean) {
    if (!fullscreen) {
        ss.selectedMode = 'screenshot';
        ss.selectedTarget = 'area';
        ss.overlayOpen = true;
        return;
    }

    const dir = ensureScreenshotDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${dir}/${timestamp}.png`;

    Process.execAsync(`${GRIM_BIN} "${filename}"`)
        .then(() => {
            try {
                copyImageToClipboard(filename);
                notify('Screenshot saved', filename, 'camera-photo-symbolic');
                bus.emit('capture:screenshot', true);
            } catch (e) {
                logger.error('screenshot', 'post-capture failed:', e);
            }
        })
        .catch(e => logger.error('screenshot', 'grim failed:', e))
        .finally(() => ss.stopFreeze());
}

/** Live grim capture of a "x,y WxH" geometry, then unfreeze. */
export function captureGeometry(ss: Screenshot, geometry: string) {
    screenshotGeometry(geometry)
        .then(() => {
            ss.stopFreeze();
            bus.emit('capture:screenshot:area');
        })
        .catch(e => {
            logger.error('screenshot', 'grim failed:', e);
            ss.stopFreeze();
        });
}

/** Open the region-selector to pick an area for capture. */
export function openRegionSelectorForCapture(
    ss: Screenshot,
    mode: 'screenshot' | 'recording'
) {
    ss.selectedMode = mode;
    ss.selectedTarget = 'area';
    ss.regionSelectorOpen = true;
}

/**
 * Called by region-selector when the user confirms a selection.
 *
 * Closes the overlay, then waits for an idle callback (after all
 * pending GTK events including the overlay unmap) before capturing.
 */
export function captureArea(ss: Screenshot, geometry: string) {
    // geometry is in grim format: "x,y WxH" (global coords).
    // captureGeometry uses grim -g which expects this format.
    // captureFromStage uses magick -crop which expects "WxH+X+Y" (local coords).
    ss.pendingCaptureGeometry = geometry;
    ss.setFreezeCapturePending(true);
    ss.regionSelectorOpen = false;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        ss.setFreezeCapturePending(false);
        if (ss.selectedMode === 'screenshot') {
            if (ss.stageHasFrame) {
                ss.captureFromStage(grimToMagickGeometry(geometry));
                bus.emit('capture:screenshot:area');
            } else {
                captureGeometry(ss, geometry);
            }
        } else {
            ss.startRecording({geometry});
            ss.stopFreeze();
            bus.emit('capture:record:area');
        }
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Close the overlay, wait for an idle callback (after widget unmap),
 * then start recording.
 */
export function startRecordingAfterOverlayClose(
    ss: Screenshot,
    target: string,
    geometry?: string | null
) {
    ss.overlayOpen = false;
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (target === 'fullscreen' && !geometry) {
            ss.toggleRecording();
            bus.emit('capture:record');
        } else if (geometry) {
            ss.startRecording({geometry});
            ss.stopFreeze();
            bus.emit('capture:record:area');
        }
        return GLib.SOURCE_REMOVE;
    });
}
