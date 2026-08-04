import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {localizeForStage, toMagickGeometry} from './geometry';
import type {BoundaryGeometry} from './types';
import {
    finalizeImage,
    freshScreenshotFilename,
    GRIM_BIN,
    MAGICK_BIN,
    notifyCaptureFailed,
} from './utils';

/**
 * Frozen-frame "stage": a full-desktop grim capture taken when the overlay
 * opens, used as the static backdrop for area selection and as the crop
 * source for the final screenshot.
 *
 * Extracted from the Screenshot service; Screenshot owns the GObject
 * `stage-texture` property and delegates all stage work here. Geometry
 * parsing/formatting lives in `geometry.ts`.
 */
export class Stage {
    #pixPath: string | null = null;
    #texture: Gdk.Texture | null = null;
    #onTextureChange: () => void;

    constructor(onTextureChange: () => void) {
        this.#onTextureChange = onTextureChange;
    }

    get pixPath(): string | null {
        return this.#pixPath;
    }

    get texture(): Gdk.Texture | null {
        return this.#texture;
    }

    /**
     * Synchronously capture the full desktop into the stage.
     *
     * Uses grim without -o so the resulting image covers the entire
     * global coordinate space (all monitors composited), matching the
     * mouse-selection coordinate system.
     */
    captureSync(): void {
        this.cleanup();

        const stagePix = `${GLib.get_tmp_dir()}/dshell-stage-${Date.now()}.png`;

        try {
            // No -o flag: captures all outputs as one combined image
            Process.exec(`${GRIM_BIN} "${stagePix}"`);
        } catch (e) {
            logger.error('screenshot', `stage capture failed: ${e}`);
            return;
        }

        this.#pixPath = stagePix;
        this.#texture = Gdk.Texture.new_from_filename(stagePix);
        this.#onTextureChange();
    }

    cleanup(): void {
        if (this.#texture) {
            this.#texture = null;
            this.#onTextureChange();
        }
        if (this.#pixPath) {
            try {
                const f = Gio.File.new_for_path(this.#pixPath);
                f.delete(null);
            } catch {
                /* file may already be deleted */
            }
            this.#pixPath = null;
        }
    }

    /**
     * Crop the stage into the screenshot directory. `geometry` is in
     * global compositor coordinates; it is localized to the stage's
     * monitor space before cropping. Null copies the full stage.
     */
    async captureCrop(geometry: BoundaryGeometry | null): Promise<boolean> {
        if (!this.#pixPath) {
            logger.error('screenshot', 'no stage texture for capture');
            notifyCaptureFailed('No frozen frame available');
            return false;
        }

        const filename = freshScreenshotFilename();

        try {
            if (geometry) {
                const crop = toMagickGeometry(localizeForStage(geometry));
                logger.info('screenshot', `captureCrop: crop ${crop} from stage`);
                await Process.execAsync(
                    `${MAGICK_BIN} "${this.#pixPath}" -crop ${crop} +repage "${filename}"`
                );
            } else {
                logger.info('screenshot', 'captureCrop: full stage copy');
                await Process.execAsync(`cp "${this.#pixPath}" "${filename}"`);
            }

            finalizeImage(filename, geometry !== null);
            return true;
        } catch (e) {
            logger.error('screenshot', `capture failed: ${e}`);
            notifyCaptureFailed(String(e));
            return false;
        }
    }
}
