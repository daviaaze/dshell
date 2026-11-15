/**
 * Screenshot selection geometry helpers.
 *
 * Pure functions extracted from the screenshot-ui widget for testability
 * and to keep the widget focused on rendering and event handling.
 */

import type {BoundaryGeometry} from '@shade/services/capture/types';

export interface Point {
    x: number;
    y: number;
}

export interface WinInfo {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

export interface SelectionState {
    dragStart: Point | null;
    dragEnd: Point | null;
    selActive: boolean;
    selectedWindow: WinInfo | null;
    windows: WinInfo[];
    monOrigin: Point;
    /** Focused monitor geometry in global compositor coordinates. */
    focusedMonitor?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    transform?: StageTransform | null;
}

/** Normalize two points into a {x, y, width, height} rect. */
export function normalizeRect(
    a: Point,
    b: Point
): {x: number; y: number; width: number; height: number} {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
    };
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Choose a resize handle near the current area edges, in overlay coordinates. */
export function resizeEdgeAt(rect: {x: number; y: number; width: number; height: number}, point: Point, tolerance = 12): ResizeEdge | null {
    const nearWest = Math.abs(point.x - rect.x) <= tolerance;
    const nearEast = Math.abs(point.x - rect.x - rect.width) <= tolerance;
    const nearNorth = Math.abs(point.y - rect.y) <= tolerance;
    const nearSouth = Math.abs(point.y - rect.y - rect.height) <= tolerance;
    const insideX = point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance;
    const insideY = point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
    if (nearNorth && insideX) {
        if (nearWest) return 'nw';
        if (nearEast) return 'ne';
        return 'n';
    }
    if (nearSouth && insideX) {
        if (nearWest) return 'sw';
        if (nearEast) return 'se';
        return 's';
    }
    if (nearWest && insideY) return 'w';
    if (nearEast && insideY) return 'e';
    return null;
}

/** Resize a rect by moving selected edges; crossing edges is supported. */
export function resizeRect(
    rect: {x: number; y: number; width: number; height: number},
    edge: ResizeEdge,
    delta: Point,
    minimum = 5
): {x: number; y: number; width: number; height: number} {
    let left = rect.x;
    let right = rect.x + rect.width;
    let top = rect.y;
    let bottom = rect.y + rect.height;
    if (edge.includes('w')) left += delta.x;
    if (edge.includes('e')) right += delta.x;
    if (edge.includes('n')) top += delta.y;
    if (edge.includes('s')) bottom += delta.y;
    if (right - left < minimum) {
        if (edge.includes('w')) left = right - minimum;
        else right = left + minimum;
    }
    if (bottom - top < minimum) {
        if (edge.includes('n')) top = bottom - minimum;
        else bottom = top + minimum;
    }
    return {x: left, y: top, width: right - left, height: bottom - top};
}

export interface StageTransform {
    /** Picture contain scale in viewport pixels per image pixel. */
    scale: number;
    /** Coordinate-space scaling after mapping desktop units to image pixels. */
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    originX: number;
    originY: number;
    stageWidth: number;
    stageHeight: number;
}

/** Contain the entire combined desktop image in its editing viewport. */
export function stageTransform(
    stageWidth: number, stageHeight: number, viewportWidth: number, viewportHeight: number,
    originX: number, originY: number, imageWidth = stageWidth, imageHeight = stageHeight
): StageTransform {
    const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
    return {
        scale,
        scaleX: imageWidth * scale / stageWidth,
        scaleY: imageHeight * scale / stageHeight,
        offsetX: (viewportWidth - imageWidth * scale) / 2,
        offsetY: (viewportHeight - imageHeight * scale) / 2,
        originX, originY, stageWidth, stageHeight,
    };
}

export function viewToStage(point: Point, transform: StageTransform): Point {
    return {
        x: (point.x - transform.offsetX) / transform.scaleX + transform.originX,
        y: (point.y - transform.offsetY) / transform.scaleY + transform.originY,
    };
}

export function stageToView(point: Point, transform: StageTransform): Point {
    return {
        x: (point.x - transform.originX) * transform.scaleX + transform.offsetX,
        y: (point.y - transform.originY) * transform.scaleY + transform.offsetY,
    };
}

/** Keep pointer-driven selection geometry inside the displayed stage image. */
export function clampStagePoint(point: Point, transform: StageTransform): Point {
    const minX = transform.offsetX;
    const minY = transform.offsetY;
    const maxX = minX + transform.stageWidth * transform.scaleX;
    const maxY = minY + transform.stageHeight * transform.scaleY;
    return {x: Math.max(minX, Math.min(point.x, maxX)), y: Math.max(minY, Math.min(point.y, maxY))};
}


/** Check if the current mode is screenshot (vs recording). */
export function isScreenshotMode(selectedMode: string): boolean {
    return selectedMode === 'screenshot';
}

/**
 * Build a typed global-compositor geometry from the current selection state.
 */
export function buildGeometry(target: string, sel: SelectionState, transform?: StageTransform | null): BoundaryGeometry | null {
    if (target === 'fullscreen') return null;
    if (target === 'monitor') {
        const mon = sel.focusedMonitor;
        if (!mon) return null;
        return {x: mon.x, y: mon.y, width: mon.width, height: mon.height};
    }
    if (target === 'area') {
        if (!sel.selActive || !sel.dragStart || !sel.dragEnd) return null;
        const rect = normalizeRect(sel.dragStart, sel.dragEnd);
        if (rect.width < 5 || rect.height < 5) return null;
        if (transform) {
            const a = viewToStage({x: rect.x, y: rect.y}, transform);
            const b = viewToStage({x: rect.x + rect.width, y: rect.y + rect.height}, transform);
            const x = Math.round(Math.max(transform.originX, Math.min(a.x, transform.originX + transform.stageWidth)));
            const y = Math.round(Math.max(transform.originY, Math.min(a.y, transform.originY + transform.stageHeight)));
            const right = Math.round(Math.max(transform.originX, Math.min(b.x, transform.originX + transform.stageWidth)));
            const bottom = Math.round(Math.max(transform.originY, Math.min(b.y, transform.originY + transform.stageHeight)));
            if (right - x < 5 || bottom - y < 5) return null;
            return {x, y, width: right - x, height: bottom - y};
        }
        const x = Math.round(sel.monOrigin.x + rect.x);
        const y = Math.round(sel.monOrigin.y + rect.y);
        const right = Math.round(sel.monOrigin.x + rect.x + rect.width);
        const bottom = Math.round(sel.monOrigin.y + rect.y + rect.height);
        return {x, y, width: right - x, height: bottom - y};
    }
    if (target === 'window') {
        if (!sel.selectedWindow) return null;
        const w = sel.selectedWindow;
        return {x: w.x, y: w.y, width: w.width, height: w.height};
    }
    return null;
}


/**
 * Topmost window under a point. `cx`/`cy` are overlay-local coordinates;
 * windows are in global compositor coordinates. Iterates the list back to
 * front so later (higher-stacked) windows win.
 */
export function windowAt(
    windows: WinInfo[],
    cx: number,
    cy: number,
    origin: Point
): WinInfo | null {
    const gx = cx + origin.x;
    const gy = cy + origin.y;
    for (let i = windows.length - 1; i >= 0; i--) {
        const w = windows[i];
        if (!w) continue;
        if (gx >= w.x && gx <= w.x + w.width && gy >= w.y && gy <= w.y + w.height) {
            return w;
        }
    }
    return null;
}

/**
 * Load windows from Hyprland client list, filtering out zero-size entries.
 */
export function loadWindows(
    clients: Array<{
        address: string;
        x: number;
        y: number;
        width: number;
        height: number;
        title: string;
    }>
): WinInfo[] {
    const list: WinInfo[] = [];
    for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        if (c.width > 0 && c.height > 0) {
            list.push({
                address: c.address,
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
                title: c.title,
            });
        }
    }
    return list;
}

/** Get the origin of the currently focused monitor. */
export function getMonitorOrigin(focusedMonitor: {x: number; y: number} | null): Point {
    return focusedMonitor ? {x: focusedMonitor.x, y: focusedMonitor.y} : {x: 0, y: 0};
}
