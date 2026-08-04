import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {bus} from '../bus';
import {toGrimGeometry} from './geometry';
import type {BoundaryGeometry, ScreenshotHandle} from './types';
import {finalizeImage, freshScreenshotFilename, GRIM_BIN} from './utils';

/**
 * Capture flows — fullscreen/area screenshot entry points and the overlay
 * confirm paths. Each function drives the service's public API.
 *
 * With the frozen stage as the single freeze mechanism there is no
 * unfreeze choreography: screenshots crop the already-captured stage
 * (no race), and only recording starts need the idle callback so the
 * overlay window has unmapped before the recorder grabs live frames.
 */

/** Fullscreen live screenshot (grim, no stage). */
export function screenshotFullscreen() {
    const filename = freshScreenshotFilename();

    Process.execAsync(`${GRIM_BIN} "${filename}"`)
        .then(() => {
            try {
                finalizeImage(filename, false);
            } catch (e) {
                logger.error('screenshot', 'post-capture failed:', e);
            }
        })
        .catch((e) => logger.error('screenshot', 'grim failed:', e));
}

/** Live grim capture of a global-compositor geometry (no stage frame). */
export function captureGeometryLive(geometry: BoundaryGeometry) {
    const filename = freshScreenshotFilename();
    Process.execAsync(`${GRIM_BIN} -g "${toGrimGeometry(geometry)}" "${filename}"`)
        .then(() => finalizeImage(filename, true))
        .catch((e) => logger.error('screenshot', 'grim failed:', e));
}

/**
 * Quick-select confirm (replaces the old region-selector flow): crop the
 * stage for screenshots, or close the overlay and start recording.
 */
export function confirmArea(ss: ScreenshotHandle, geometry: BoundaryGeometry) {
    if (ss.selectedMode === 'screenshot') {
        if (ss.stageHasFrame) {
            // captureCrop localizes to stage coords and emits the event
            ss.captureFromStage(geometry);
        } else {
            ss.overlayOpen = false;
            captureGeometryLive(geometry);
        }
        return;
    }

    startRecordingAfterOverlayClose(ss, geometry);
}

/**
 * Close the overlay, wait for an idle callback (after widget unmap),
 * then start recording. Only recording needs this: the recorder grabs
 * live frames, so the overlay window must be gone first.
 */
export function startRecordingAfterOverlayClose(
    ss: ScreenshotHandle,
    geometry: BoundaryGeometry | null
) {
    ss.overlayOpen = false;
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (geometry) {
            ss.startRecording({geometry});
            bus.emit('capture:record:area');
        } else {
            ss.toggleRecording();
            bus.emit('capture:record');
        }
        return GLib.SOURCE_REMOVE;
    });
}
