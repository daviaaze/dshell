import Cairo from 'gi://cairo?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {getHyprland} from '#/lib/hyprland';
import type Screenshot from '#/lib/services/capture/screenshot';

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

/**
 * Full draw function for the screenshot overlay — dim, window outlines,
 * selection rectangle, and hint text.
 */
export function draw(
    _da: Gtk.DrawingArea,
    cr: Cairo.Context,
    width: number,
    height: number,
    params: {
        ss: Screenshot;
        selActive: boolean;
        dragStart: Point | null;
        dragEnd: Point | null;
        selectedWindow: WinInfo | null;
        windows: WinInfo[];
        monOrigin: Point;
    }
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
    const sWin = selectedWindow;
    const winL = windows;
    const hyprland = getHyprland();
    if (!hyprland) return null;

    // ── Dim overlay ──────────────────────────────────────────
    cr.setSourceRGBA(DIM_COLOR.r, DIM_COLOR.g, DIM_COLOR.b, DIM_COLOR.a);

    if (target === 'area' && sel && sel.width >= MIN_SELECTION) {
        drawDimRect(cr, 0, 0, width, sel.y);
        drawDimRect(
            cr,
            0,
            sel.y + sel.height,
            width,
            height - sel.y - sel.height
        );
        drawDimRect(cr, 0, sel.y, sel.x, sel.height);
        drawDimRect(
            cr,
            sel.x + sel.width,
            sel.y,
            width - sel.x - sel.width,
            sel.height
        );
    } else if (target === 'window' && sWin) {
        const origin = monOrigin;
        const lx = sWin.x - origin.x;
        const ly = sWin.y - origin.y;
        drawDimRect(cr, 0, 0, width, ly);
        drawDimRect(cr, 0, ly + sWin.height, width, height - ly - sWin.height);
        drawDimRect(cr, 0, ly, lx, sWin.height);
        drawDimRect(
            cr,
            lx + sWin.width,
            ly,
            width - lx - sWin.width,
            sWin.height
        );
    } else if (target === 'monitor') {
        const m = hyprland.focusedMonitor;
        if (m) {
            const origin = monOrigin;
            const lx = m.x - origin.x;
            const ly = m.y - origin.y;
            drawDimRect(cr, 0, 0, width, ly);
            drawDimRect(cr, 0, ly + m.height, width, height - ly - m.height);
            drawDimRect(cr, 0, ly, lx, m.height);
            drawDimRect(cr, lx + m.width, ly, width - lx - m.width, m.height);
        }
    } else if (target !== 'fullscreen') {
        cr.rectangle(0, 0, width, height);
    }
    cr.fill();

    // ── Window outlines ──────────────────────────────────────
    if (target === 'window') {
        const origin = monOrigin;
        cr.setLineWidth(2);
        cr.setSourceRGBA(1, 1, 1, 0.4);

        for (const w of winL) {
            const lx = w.x - origin.x;
            const ly = w.y - origin.y;
            cr.rectangle(lx, ly, w.width, w.height);
        }
        cr.stroke();

        if (sWin) {
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
    }

    // ── Selection rectangle ──────────────────────────────────
    if (target === 'area' && sel && sel.width >= MIN_SELECTION) {
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

    // ── Hint text ────────────────────────────────────────────
    if (!selActive && target === 'area') {
        const text = 'Drag to select an area';
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.setFontSize(14);
        const ext = cr.textExtents(text);
        cr.moveTo((width - ext.width) / 2, height / 2 - ext.y_bearing);
        cr.showText(text);
    }
    if (!sWin && target === 'window') {
        const text = 'Click a window to select it';
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.setFontSize(14);
        const ext = cr.textExtents(text);
        cr.moveTo((width - ext.width) / 2, height / 2 - ext.y_bearing);
        cr.showText(text);
    }
}
