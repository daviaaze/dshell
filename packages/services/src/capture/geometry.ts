import logger from '@shade/core/logger';
import {getHyprland} from '../hyprland';
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

export interface MonitorSnapshot {
    x: number;
    y: number;
    width: number;
    height: number;
    scale?: number;
    transform?: number | string;
    disabled?: boolean;
}

/** Bounds of all outputs in global logical coordinates. */
export function desktopStageBounds(monitors: MonitorSnapshot[]): BoundaryGeometry {
    const active = monitors.filter((m) => !m.disabled);
    if (active.length === 0) return {x: 0, y: 0, width: 1, height: 1};
    const rects = active.map((m) => {
        const transform = Number(m.transform ?? 0);
        const rotated = Math.abs(transform) % 2 === 1;
        const scale = m.scale && m.scale > 0 ? m.scale : 1;
        const width = (rotated ? m.height : m.width) / scale;
        const height = (rotated ? m.width : m.height) / scale;
        return {x: m.x, y: m.y, width, height};
    });
    const x = Math.min(...rects.map((m) => m.x));
    const y = Math.min(...rects.map((m) => m.y));
    const right = Math.max(...rects.map((m) => m.x + m.width));
    const bottom = Math.max(...rects.map((m) => m.y + m.height));
    return {x, y, width: right - x, height: bottom - y};
}

/** Read the compositor's raw output rectangles and normalize transform/scale once. */
export function getDesktopStageBounds(): BoundaryGeometry {
    const hyprland = getHyprland();
    if (!hyprland) return {x: 0, y: 0, width: 1, height: 1};
    try {
        const monitors = JSON.parse(hyprland.message('j/monitors')) as MonitorSnapshot[];
        if (monitors.length > 0) return desktopStageBounds(monitors);
        return desktopStageBounds(
            hyprland.monitors.map((m) => ({
                x: m.x,
                y: m.y,
                width: m.width,
                height: m.height,
                scale: m.scale,
                transform: m.transform,
            }))
        );
    } catch (error) {
        logger.warn('screenshot', `could not read monitor snapshot for stage bounds: ${error}`);
        return desktopStageBounds(
            hyprland.monitors.map((m) => ({
                x: m.x,
                y: m.y,
                width: m.width,
                height: m.height,
                scale: m.scale,
                transform: m.transform,
            }))
        );
    }
}

/** Convert a global rectangle into combined-stage pixels using desktop bounds. */
export function localizeToStagePixels(
    g: BoundaryGeometry,
    bounds: BoundaryGeometry,
    imageWidth = bounds.width,
    imageHeight = bounds.height
): BoundaryGeometry {
    const scaleX = imageWidth / bounds.width;
    const scaleY = imageHeight / bounds.height;
    return {
        x: Math.round((g.x - bounds.x) * scaleX),
        y: Math.round((g.y - bounds.y) * scaleY),
        width: Math.round(g.width * scaleX),
        height: Math.round(g.height * scaleY),
    };
}

/** Translate global compositor coordinates into the combined grim image. */
export function localizeForStage(
    g: BoundaryGeometry,
    imageWidth?: number,
    imageHeight?: number
): BoundaryGeometry {
    if (!getHyprland()) return g;
    return localizeToStagePixels(g, getDesktopStageBounds(), imageWidth, imageHeight);
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
