import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '#/lib/core/logger';
import {Process} from '#/lib/core/process';
import {
    ensureScreenshotDir,
    notify,
    copyImageToClipboard,
    GRIM_BIN,
    MAGICK_BIN,
} from './utils';

const ICON_ERROR = 'dialog-error-symbolic';

/** Convert grim "x,y WxH" (global coords) to magick "WxH+X+Y" (monitor-local). */
export function grimToMagickGeometry(geometry: string): string {
    const [pos, size] = geometry.split(' ');
    const [gx, gy] = pos!.split(',').map(Number);
    const [gw, gh] = size!.split('x').map(Number);
    const mon = AstalHyprland.get_default().focused_monitor;
    const ox = mon?.x ?? 0;
    const oy = mon?.y ?? 0;
    return `${gw}x${gh}+${gx! - ox}+${gy! - oy}`;
}

/**
 * Frozen-frame "stage": a full-screen grim capture taken when the overlay
 * opens, used as the static backdrop for area selection and as the crop
 * source for the final screenshot.
 *
 * Extracted from the Screenshot service; Screenshot owns the GObject
 * `stage-texture` property and delegates all stage work here.
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

    /** Synchronously capture the focused monitor into the stage. */
    captureSync(): void {
        this.cleanup();

        const monitor = AstalHyprland.get_default().focused_monitor;
        const monitorName = monitor?.name || '';
        const stagePix = `${GLib.get_tmp_dir()}/dshell-stage-${Date.now()}.png`;

        try {
            if (monitorName) {
                Process.exec(`${GRIM_BIN} -o "${monitorName}" "${stagePix}"`);
            } else {
                Process.exec(`${GRIM_BIN} "${stagePix}"`);
            }
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
            } catch { /* file may already be deleted */ }
            this.#pixPath = null;
        }
    }

    /** Crop (or copy) the stage into the screenshot directory. */
    async captureCrop(geometry: string | null): Promise<boolean> {
        if (!this.#pixPath) {
            logger.error('screenshot', 'no stage texture for capture');
            notify('Screenshot failed', 'No frozen frame available', ICON_ERROR);
            return false;
        }

        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        try {
            if (geometry) {
                logger.info('screenshot', `captureCrop: crop ${geometry} from stage`);
                await Process.execAsync(
                    `${MAGICK_BIN} "${this.#pixPath}" -crop ${geometry} +repage "${filename}"`
                );
            } else {
                logger.info('screenshot', 'captureCrop: full stage copy');
                await Process.execAsync(`cp "${this.#pixPath}" "${filename}"`);
            }

            copyImageToClipboard(filename);
            notify('Screenshot saved', filename, 'camera-photo-symbolic');
            return true;
        } catch (e) {
            logger.error('screenshot', `capture failed: ${e}`);
            notify('Screenshot failed', String(e), ICON_ERROR);
            return false;
        }
    }
}

/** Live grim capture of a "x,y WxH" geometry (no frozen stage). */
export async function screenshotGeometry(geometry: string): Promise<void> {
    const dir = ensureScreenshotDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${dir}/${timestamp}.png`;

    await Process.execAsync(`${GRIM_BIN} -g "${geometry}" "${filename}"`);
    copyImageToClipboard(filename);
    notify('Screenshot saved', filename, 'camera-photo-symbolic');
}
