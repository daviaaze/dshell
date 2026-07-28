import Gdk from 'gi://Gdk?version=4.0';
import {getHyprland} from '../../hyprland';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '../../core/logger';
import {Process} from '../../core/process';
import {
    ensureScreenshotDir,
    notify,
    copyImageToClipboard,
    GRIM_BIN,
    MAGICK_BIN,
} from './utils';
import type {BoundaryGeometry} from './types';

const ICON_ERROR = 'dialog-error-symbolic';

// ── Typed Geometry ───────────────────────────────────────────────────────────

export type {BoundaryGeometry};

/**
 * Parse a grim-format geometry string "x,y WxH" into a typed struct.
 * Returns null on parse failure.
 */
export function parseGrimGeometry(s: string): BoundaryGeometry | null {
    const parts = s.split(' ');
    if (parts.length !== 2) return null;
    const [pos, size] = parts;
    if (!pos || !size) return null;
    const [sx, sy] = pos.split(',');
    const [sw, sh] = size.split('x');
    if (!sx || !sy || !sw || !sh) return null;
    const x = Number(sx),
        y = Number(sy),
        w = Number(sw),
        h = Number(sh);
    if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) return null;
    if (w <= 0 || h <= 0) return null;
    return {x, y, width: w, height: h};
}

/**
 * Format a boundary geometry as grim "x,y WxH".
 */
export function toGrimGeometry(g: BoundaryGeometry): string {
    return `${g.x},${g.y} ${g.width}x${g.height}`;
}

/**
 * Format a boundary geometry as magick "WxH+X+Y" (monitor-local coords).
 */
export function toMagickGeometry(g: BoundaryGeometry): string {
    return `${g.width}x${g.height}+${g.x}+${g.y}`;
}

/**
 * Find the AstalHyprland monitor whose region contains the given point.
 * Falls back to the focused monitor if no match is found.
 */
function monitorForPoint(x: number, y: number) {
    const hl = getHyprland();
    if (!hl) return null;
    const monitors = hl.monitors;
    // Look through the monitor list for one that contains (x, y)
    for (let i = 0; i < monitors.length; i++) {
        const m = monitors[i];
        if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) {
            return m;
        }
    }
    // Fallback: focused monitor
    return hl.focusedMonitor;
}

/**
 * Convert a grim "x,y WxH" global geometry to magick "WxH+X+Y" in the
 * coordinate space of the monitor that contains the selection.
 *
 * Uses the AstalHyprland monitor list (not just focusedMonitor) so
 * multi-monitor selections work correctly.
 */
export function grimToMagickGeometry(geometry: string): string {
    const g = parseGrimGeometry(geometry);
    if (!g) {
        logger.warn('screenshot', 'cannot parse grim geometry:', geometry);
        // Best-effort fallback: use the full geometry as-is
        const [, size] = geometry.split(' ');
        const [gw, gh] = size!.split('x').map(Number);
        return `${gw}x${gh}+0+0`;
    }
    const mon = monitorForPoint(g.x, g.y);
    if (!mon) return toMagickGeometry(g);
    return toMagickGeometry({
        x: g.x - mon.x,
        y: g.y - mon.y,
        width: g.width,
        height: g.height,
    });
}

/**
 * Get the AstalHyprland monitor that a grim-format geometry falls within.
 */
export function monitorForGeometry(geometry: string) {
    const g = parseGrimGeometry(geometry);
    if (!g) {
        const hl = getHyprland();
        return hl ? hl.focusedMonitor : null;
    }
    return monitorForPoint(g.x, g.y);
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

    /** Crop (or copy) the stage into the screenshot directory. */
    async captureCrop(geometry: string | null): Promise<boolean> {
        if (!this.#pixPath) {
            logger.error('screenshot', 'no stage texture for capture');
            notify(
                'Screenshot failed',
                'No frozen frame available',
                ICON_ERROR
            );
            return false;
        }

        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        try {
            if (geometry) {
                logger.info(
                    'screenshot',
                    `captureCrop: crop ${geometry} from stage`
                );
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
