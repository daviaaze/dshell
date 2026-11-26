import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {localizeForStage, toMagickGeometry} from './geometry';
import type {BoundaryGeometry} from './types';
import {
    captureBlocked,
    createPrivateCaptureDirectory,
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
    #directory: string | null = null;
    #generation = 0;
    #pendingCapture: Gio.Cancellable | null = null;
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
     * Capture the full desktop without blocking the shell main loop.
     *
     * Uses grim without -o so the resulting image covers the entire
     * global coordinate space (all monitors composited), matching the
     * mouse-selection coordinate system.
     */
    async capture(): Promise<boolean> {
        this.cleanup();
        if (captureBlocked()) return false;
        const generation = this.#generation;
        const cancellation = new Gio.Cancellable();
        this.#pendingCapture = cancellation;
        let directory: string | null = null;
        let stagePix: string | null = null;

        try {
            directory = createPrivateCaptureDirectory('stage');
            stagePix = `${directory}/frame.png`;
            Gio.File.new_for_path(stagePix).create(Gio.FileCreateFlags.PRIVATE, null).close(null);
            // No -o flag: capture every output in the global coordinate space.
            await Process.execAsyncv([GRIM_BIN, stagePix], false, {
                timeoutMs: 5_000,
                cancellable: cancellation,
            });
            if (generation !== this.#generation || captureBlocked()) return false;
            const texture = Gdk.Texture.new_from_filename(stagePix);
            this.#pixPath = stagePix;
            this.#directory = directory;
            this.#texture = texture;
            directory = null;
            this.#onTextureChange();
            return true;
        } catch (error) {
            if (generation === this.#generation) {
                this.cleanup();
                logger.error('screenshot', `stage capture failed: ${error}`);
            }
            return false;
        } finally {
            if (this.#pendingCapture === cancellation) this.#pendingCapture = null;
            if (directory) this.#removeFiles(stagePix, directory);
        }
    }

    cleanup(): void {
        this.#generation++;
        this.#pendingCapture?.cancel();
        this.#pendingCapture = null;
        const path = this.#pixPath;
        const directory = this.#directory;
        this.#pixPath = null;
        this.#directory = null;
        this.#removeFiles(path, directory);
        if (this.#texture) {
            this.#texture = null;
            this.#onTextureChange();
        }
    }

    #removeFiles(path: string | null, directory: string | null): void {
        for (const filename of [path, directory]) {
            if (!filename) continue;
            try {
                const file = Gio.File.new_for_path(filename);
                if (file.query_exists(null)) file.delete(null);
            } catch (error) {
                logger.warn('screenshot', `could not remove private stage ${filename}: ${error}`);
            }
        }
    }

    /**
     * Crop the combined stage. `geometry` stays in global compositor
     * coordinates until localized against the desktop bounds and texture
     * pixel dimensions.
     */
    async captureCrop(geometry: BoundaryGeometry | null): Promise<boolean> {
        if (captureBlocked()) return false;
        if (!this.#pixPath) {
            logger.error('screenshot', 'no stage texture for capture');
            notifyCaptureFailed('No frozen frame available');
            return false;
        }

        try {
            const filename = freshScreenshotFilename();
            if (geometry) {
                const crop = toMagickGeometry(
                    localizeForStage(
                        geometry,
                        this.#texture?.get_width(),
                        this.#texture?.get_height()
                    )
                );
                logger.info('screenshot', `captureCrop: crop ${crop} from stage`);
                await Process.execAsyncv([
                    MAGICK_BIN,
                    this.#pixPath,
                    '-crop',
                    crop,
                    '+repage',
                    filename,
                ]);
            } else {
                logger.info('screenshot', 'captureCrop: full stage copy');
                await Process.execAsyncv(['cp', '--', this.#pixPath, filename]);
            }

            await finalizeImage(filename, geometry !== null);
            return true;
        } catch (e) {
            logger.error('screenshot', `capture failed: ${e}`);
            notifyCaptureFailed(String(e));
            return false;
        }
    }
}
