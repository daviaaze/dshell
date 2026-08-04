import Cairo from 'gi://cairo?version=1.0';
import type Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import type Screenshot from '@shade/services/capture/screenshot';
import type {BoundaryGeometry} from '@shade/services/capture/types';
import {getHyprland} from '@shade/services/hyprland';

// ── Constants ─────────────────────────────────────────────────────

const DIM_COLOR = {r: 0, g: 0, b: 0, a: 0.35};
const ACCENT = {r: 0.3, g: 0.6, b: 1, a: 0.9};
const MIN_SELECTION = 5;
const HANDLE_SIZE = 8;
const WINDOW_HINT_COLOR = {r: 1, g: 1, b: 1, a: 0.15};

interface Point {
    x: number;
    y: number;
}

type Geom = BoundaryGeometry;

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

function drawDimRect(cr: Cairo.Context, x: number, y: number, w: number, h: number) {
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
        dimAround(cr, width, height, sWin.x - origin.x, sWin.y - origin.y, sWin.width, sWin.height);
    } else if (target === 'monitor') {
        const hyprland = getHyprland();
        const m = hyprland?.focusedMonitor;
        if (m) {
            dimAround(cr, width, height, m.x - origin.x, m.y - origin.y, m.width, m.height);
        }
    } else if (target !== 'fullscreen') {
        cr.rectangle(0, 0, width, height);
    }
}

function drawCornerHandles(cr: Cairo.Context, sel: Geom) {
    cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, ACCENT.a);
    const hs = HANDLE_SIZE;
    const corners = [
        {x: sel.x - hs / 2, y: sel.y - hs / 2},
        {x: sel.x + sel.width - hs / 2, y: sel.y - hs / 2},
        {x: sel.x - hs / 2, y: sel.y + sel.height - hs / 2},
        {x: sel.x + sel.width - hs / 2, y: sel.y + sel.height - hs / 2},
    ];
    for (const c of corners) {
        cr.rectangle(c.x, c.y, hs, hs);
    }
    cr.fill();
}

function drawWindowHints(cr: Cairo.Context, wins: WinInfo[], origin: Point) {
    cr.setSourceRGBA(
        WINDOW_HINT_COLOR.r,
        WINDOW_HINT_COLOR.g,
        WINDOW_HINT_COLOR.b,
        WINDOW_HINT_COLOR.a
    );
    cr.setLineWidth(1);
    for (const win of wins) {
        const lx = win.x - origin.x;
        const ly = win.y - origin.y;
        cr.rectangle(lx, ly, win.width, win.height);
        cr.stroke();
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
    if (target === 'area') {
        // Window snap hints in area mode (was region-selector behavior)
        drawWindowHints(cr, winL, monOrigin);
        return;
    }
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
    cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, ACCENT.a);
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

/** Draws the selection rectangle, corner handles and its size label. */
function drawSelection(cr: Cairo.Context, target: string, sel: Geom | null) {
    if (target !== 'area' || !sel || sel.width < MIN_SELECTION) return;

    cr.setLineWidth(2);
    cr.setSourceRGBA(ACCENT.r, ACCENT.g, ACCENT.b, ACCENT.a);
    cr.rectangle(sel.x, sel.y, sel.width, sel.height);
    cr.stroke();

    drawCornerHandles(cr, sel);

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

function drawCenteredText(cr: Cairo.Context, width: number, height: number, text: string) {
    cr.setSourceRGBA(1, 1, 1, 0.7);
    cr.setFontSize(14);
    const ext = cr.textExtents(text);
    cr.moveTo((width - ext.width) / 2, height / 2 - ext.y_bearing);
    cr.showText(text);
}

/** Text with a translucent backing box, centered at (cx, y). */
function drawLabel(
    cr: Cairo.Context,
    text: string,
    cx: number,
    y: number,
    weight: Cairo.FontWeight,
    bgAlpha: number,
    fgAlpha: number
) {
    cr.selectFontFace('sans-serif', Cairo.FontSlant.NORMAL, weight);
    cr.setFontSize(weight === Cairo.FontWeight.BOLD ? 13 : 12);
    const ext = cr.textExtents(text);
    const pad = 4;
    const tx = cx - ext.width / 2;
    cr.rectangle(tx - pad, y - ext.height + pad, ext.width + pad * 2, ext.height + pad);
    cr.setSourceRGBA(0, 0, 0, bgAlpha);
    cr.fill();
    cr.moveTo(tx, y);
    cr.setSourceRGBA(1, 1, 1, fgAlpha);
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
    // Quick-select hint (matches the old region-selector footer)
    if (target === 'area') {
        drawLabel(
            cr,
            'Drag to select · Click a window to snap · Enter to confirm · Esc to cancel',
            width / 2,
            height - 32,
            Cairo.FontWeight.NORMAL,
            0.5,
            0.7
        );
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
    } catch (e) {
        logger.error('screenshot-ui', `overlay draw failed: ${e}`);
    }
}

function drawImpl(
    _da: Gtk.DrawingArea,
    cr: Cairo.Context,
    width: number,
    height: number,
    params: DrawParams
) {
    const {ss, selActive, dragStart, dragEnd, selectedWindow, windows, monOrigin} = params;
    const target = ss.selectedTarget;
    const sel = selActive && dragStart && dragEnd ? normalizeRect(dragStart, dragEnd) : null;
    const hyprland = getHyprland();
    if (!hyprland) return;

    // ── Dim overlay ──────────────────────────────────────────
    cr.setSourceRGBA(DIM_COLOR.r, DIM_COLOR.g, DIM_COLOR.b, DIM_COLOR.a);
    drawDimOverlay(cr, width, height, target, sel, selectedWindow, windows, monOrigin);
    cr.fill();

    // ── Window outlines, selection and hints ─────────────────
    drawWindowOutlines(cr, target, selectedWindow, windows, monOrigin);
    drawSelection(cr, target, sel);
    drawHints(cr, width, height, selActive, target, selectedWindow);
}
