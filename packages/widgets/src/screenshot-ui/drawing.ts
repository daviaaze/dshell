import Cairo from 'gi://cairo?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getHyprland} from '@shade/services/hyprland';
import logger from '@shade/core/logger';
import type Screenshot from '@shade/services/capture/screenshot';

// ── Constants ─────────────────────────────────────────────────────

const DIM_COLOR = {r: 0, g: 0, b: 0, a: 0.35};
const MIN_SELECTION = 5;

interface Point {
    x: number;
    y: number;
}

interface Geom {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface WinInfo {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

interface DrawParams {
    ss: Screenshot;
    selActive: boolean;
    dragStart: Point | null;
    dragEnd: Point | null;
    selectedWindow: WinInfo | null;
    windows: WinInfo[];
    monOrigin: Point;
}

// ── Helpers ───────────────────────────────────────────────────────

function normalizeRect(a: Point, b: Point): Geom {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    return {x, y, width, height};
}

function drawDimRect(
    cr: Cairo.Context,
    x: number,
    y: number,
    w: number,
    h: number
) {
    if (w <= 0 || h <= 0) return;
    cr.rectangle(x, y, w, h);
}

/** Adds the dim-out rectangles around a clear region to the path. */
function dimAround(
    cr: Cairo.Context,
    width: number,
    height: number,
    x: number,
    y: number,
    w: number,
    h: number
) {
    drawDimRect(cr, 0, 0, width, y);
    drawDimRect(cr, 0, y + h, width, height - y - h);
    drawDimRect(cr, 0, y, x, h);
    drawDimRect(cr, x + w, y, width - x - w, h);
}

/** Dims everything except the active area / window / monitor. */
function drawDimOverlay(
    cr: Cairo.Context,
    width: number,
    height: number,
    target: string,
    sel: Geom | null,
    sWin: WinInfo | null,
    winL: WinInfo[],
    monOrigin: Point
): void {
    const origin = monOrigin;
    if (target === 'area' && sel && sel.width >= MIN_SELECTION) {
        dimAround(cr, width, height, sel.x, sel.y, sel.width, sel.height);
    } else if (target === 'window' && sWin) {
        dimAround(
            cr,
            width,
            height,
            sWin.x - origin.x,
            sWin.y - origin.y,
            sWin.width,
            sWin.height
        );
    } else if (target === 'monitor') {
        const hyprland = getHyprland();
        const m = hyprland?.focusedMonitor;
        if (m) {
            dimAround(
                cr,
                width,
                height,
                m.x - origin.x,
                m.y - origin.y,
                m.width,
                m.height
            );
        }
    } else if (target !== 'fullscreen') {
        cr.rectangle(0, 0, width, height);
    }
}

/** Draws window outlines and the selected window's highlight + title. */
function drawWindowOutlines(
    cr: Cairo.Context,
    target: string,
    sWin: WinInfo | null,
    winL: WinInfo[],
    monOrigin: Point
) {
    if (target !== 'window') return;
    const origin = monOrigin;
    cr.setLineWidth(2);
    cr.setSourceRGBA(1, 1, 1, 0.4);

    for (const w of winL) {
        cr.rectangle(w.x - origin.x, w.y - origin.y, w.width, w.height);
    }
    cr.stroke();

    if (!sWin) return;
    const lx = sWin.x - origin.x;
    const ly = sWin.y - origin.y;
    cr.setLineWidth(4);
    cr.setSourceRGBA(0.3, 0.6, 1, 0.9);
    cr.rectangle(lx, ly, sWin.width, sWin.height);
    cr.stroke();

    cr.setSourceRGBA(0, 0, 0, 0.7);
    cr.rectangle(lx, ly - 24, sWin.width, 24);
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, 1);
    cr.setFontSize(12);
    cr.moveTo(lx + 4, ly - 6);
    cr.showText(sWin.title.substring(0, 40));
}

/** Draws the selection rectangle and its size label. */
function drawSelection(
    cr: Cairo.Context,
    target: string,
    sel: Geom | null
) {
    if (target !== 'area' || !sel || sel.width < MIN_SELECTION) return;

    cr.setLineWidth(2);
    cr.setSourceRGBA(0.3, 0.6, 1, 0.9);
    cr.rectangle(sel.x, sel.y, sel.width, sel.height);
    cr.stroke();

    const label = `${sel.width}×${sel.height}`;
    const labelX = sel.x + 4;
    const labelY = sel.y - 6;
    const textLen = label.length * 7 + 8;
    cr.setSourceRGBA(0, 0, 0, 0.7);
    cr.rectangle(labelX, labelY - 14, textLen, 20);
    cr.fill();

    cr.setSourceRGBA(1, 1, 1, 1);
    cr.setFontSize(12);
    cr.moveTo(labelX + 4, labelY);
    cr.showText(label);
}

function drawCenteredText(
    cr: Cairo.Context,
    width: number,
    height: number,
    text: string
) {
    cr.setSourceRGBA(1, 1, 1, 0.7);
    cr.setFontSize(14);
    const ext = cr.textExtents(text);
    cr.moveTo((width - ext.width) / 2, height / 2 - ext.y_bearing);
    cr.showText(text);
}

/** Draws contextual hint text for unsold area/window targets. */
function drawHints(
    cr: Cairo.Context,
    width: number,
    height: number,
    selActive: boolean,
    target: string,
    sWin: WinInfo | null
) {
    if (!selActive && target === 'area') {
        drawCenteredText(cr, width, height, 'Drag to select an area');
    }
    if (!sWin && target === 'window') {
        drawCenteredText(cr, width, height, 'Click a window to select it');
    }
}

/**
 * Full draw function for the screenshot overlay — dim, window outlines,
 * selection rectangle, and hint text.
 */
export function draw(
    _da: Gtk.DrawingArea,
    cr: Cairo.Context,
    width: number,
    height: number,
    params: DrawParams
) {
    // Surface draw failures to the log instead of silently painting nothing.
    try {
        drawImpl(_da, cr, width, height, params);
        if (!drawLogged) {
            drawLogged = true;
            logger.info(
                'screenshot-ui',
                `overlay draw: first paint ${width}x${height}`
            );
        }
    } catch (e) {
        logger.error('screenshot-ui', `overlay draw failed: ${e}`);
    }
}

let drawLogged = false;

function drawImpl(
    _da: Gtk.DrawingArea,
    cr: Cairo.Context,
    width: number,
    height: number,
    params: DrawParams
) {
    const {
        ss,
        selActive,
        dragStart,
        dragEnd,
        selectedWindow,
        windows,
        monOrigin,
    } = params;
    const target = ss.selectedTarget;
    const sel =
        selActive && dragStart && dragEnd
            ? normalizeRect(dragStart, dragEnd)
            : null;
    const hyprland = getHyprland();
    if (!hyprland) return;

    // ── Dim overlay ──────────────────────────────────────────
    cr.setSourceRGBA(DIM_COLOR.r, DIM_COLOR.g, DIM_COLOR.b, DIM_COLOR.a);
    drawDimOverlay(
        cr,
        width,
        height,
        target,
        sel,
        selectedWindow,
        windows,
        monOrigin
    );
    cr.fill();

    // ── Window outlines, selection and hints ─────────────────
    drawWindowOutlines(cr, target, selectedWindow, windows, monOrigin);
    drawSelection(cr, target, sel);
    drawHints(cr, width, height, selActive, target, selectedWindow);
}