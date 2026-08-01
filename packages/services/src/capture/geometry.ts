import {getHyprland} from '../hyprland';
import logger from '@shade/core/logger';
import type {BoundaryGeometry} from './types';

/**
 * Typed geometry helpers. `BoundaryGeometry` is the canonical representation
 * inside the capture domain; grim ("x,y WxH") and magick ("WxH+X+Y") strings
 * exist only at process boundaries (grim / magick / wl-screenrec CLIs).
 */

/** Parse a grim-format geometry string "x,y WxH". Returns null on failure. */
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

/** Format as grim "x,y WxH" (global compositor coordinates). */
export function toGrimGeometry(g: BoundaryGeometry): string {
    return `${g.x},${g.y} ${g.width}x${g.height}`;
}

/** Format as magick "WxH+X+Y" (caller ensures the right coordinate space). */
export function toMagickGeometry(g: BoundaryGeometry): string {
    return `${g.width}x${g.height}+${g.x}+${g.y}`;
}

/**
 * Find the Hyprland monitor whose region contains the given point.
 * Falls back to the focused monitor when no match is found.
 */
export function monitorForPoint(x: number, y: number) {
    const hl = getHyprland();
    if (!hl) return null;
    for (const m of hl.monitors) {
        if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) {
            return m;
        }
    }
    return hl.focusedMonitor;
}

/** The monitor a geometry falls within (by its top-left point). */
export function monitorForGeometry(g: BoundaryGeometry) {
    return monitorForPoint(g.x, g.y);
}

/**
 * Translate a global-compositor geometry into the coordinate space of the
 * stage image for cropping. The stage is captured with plain `grim` (all
 * outputs composited), so stage coordinates are global minus the origin of
 * the monitor containing the selection.
 */
export function localizeForStage(g: BoundaryGeometry): BoundaryGeometry {
    const mon = monitorForGeometry(g);
    if (!mon) return g;
    return {x: g.x - mon.x, y: g.y - mon.y, width: g.width, height: g.height};
}

/**
 * Parse a grim string and localize it for the stage, with a best-effort
 * fallback for malformed input.
 */
export function grimToStageGeometry(geometry: string): BoundaryGeometry {
    const g = parseGrimGeometry(geometry);
    if (!g) {
        logger.warn('screenshot', 'cannot parse grim geometry:', geometry);
        const [, size] = geometry.split(' ');
        const [gw, gh] = (size ?? '0x0').split('x').map(Number);
        return {x: 0, y: 0, width: gw || 0, height: gh || 0};
    }
    return localizeForStage(g);
}