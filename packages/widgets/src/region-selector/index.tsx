import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {getHyprland} from '@shade/services/hyprland';
import Cairo from 'gi://cairo?version=1.0';
import {Accessor, bind, createState} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import Screenshot from '@shade/services/capture/screenshot';
import {getWindowGeometries} from '@shade/services/monitoring/windows';
import type {WindowGeometry} from '@shade/services/monitoring/windows';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';

// ── Constants ───────────────────────────────────────────────────

const DIM_COLOR = {r: 0, g: 0, b: 0, a: 0.35};
const BORDER_COLOR = {r: 0.21, g: 0.51, b: 0.89, a: 1.0};
const BORDER_WIDTH = 2;
const HANDLE_SIZE = 8;
const WINDOW_HINT_COLOR = {r: 1, g: 1, b: 1, a: 0.15};
const DIM_TEXT_COLOR = {r: 1, g: 1, b: 1, a: 0.9};

// ── Types ───────────────────────────────────────────────────────

interface Point {
    x: number;
    y: number;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Shared mutable state for the selector's draw + input handlers. */
interface SelectorState {
    selStart: Accessor<Point | null>;
    setSelStart: (v: Point | null) => void;
    selEnd: Accessor<Point | null>;
    setSelEnd: (v: Point | null) => void;
    windows: Accessor<WindowGeometry[]>;
    monOrigin: Accessor<Point>;
    daRef: {current: Gtk.DrawingArea | null};
}

// ── Helpers ─────────────────────────────────────────────────────

function getNormalizedSelection(
    start: Point | null,
    end: Point | null
): Rect | null {
    if (!start || !end) return null;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 5 && h < 5) return null;
    return {x, y, width: w, height: h};
}

// ── Confirm / Cancel ────────────────────────────────────────────

function confirmSelection(state: SelectorState) {
    const sel = getNormalizedSelection(state.selStart(), state.selEnd());
    if (!sel) return;
    const o = state.monOrigin();
    const geometry = `${sel.x + o.x},${sel.y + o.y} ${sel.width}x${sel.height}`;
    bus.emit('capture:cmd:capture-area', geometry);
}

function cancelSelection(state: SelectorState) {
    state.setSelStart(null);
    state.setSelEnd(null);
    bus.emit('capture:cmd:region-selector:close');
}

// ── Drawing ─────────────────────────────────────────────────────

function dimBackground(cr: Cairo.Context, w: number, h: number, sel: Rect | null) {
    if (sel) {
        // Draw 4 rectangles around selection to dim everything except it
        cr.rectangle(0, 0, w, sel.y);
        cr.rectangle(0, sel.y + sel.height, w, h - sel.y - sel.height);
        cr.rectangle(0, sel.y, sel.x, sel.height);
        cr.rectangle(sel.x + sel.width, sel.y, w - sel.x - sel.width, sel.height);
    } else {
        cr.rectangle(0, 0, w, h);
    }
    cr.setSourceRGBA(DIM_COLOR.r, DIM_COLOR.g, DIM_COLOR.b, DIM_COLOR.a);
    cr.fill();
}

function drawWindowHints(
    cr: Cairo.Context,
    wins: WindowGeometry[],
    origin: Point,
    w: number,
    h: number
) {
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
        if (lx < w && ly < h) {
            cr.rectangle(lx, ly, win.width, win.height);
            cr.stroke();
        }
    }
}

function drawSelectionRect(cr: Cairo.Context, sel: Rect) {
    cr.setSourceRGBA(
        BORDER_COLOR.r,
        BORDER_COLOR.g,
        BORDER_COLOR.b,
        BORDER_COLOR.a
    );
    cr.setLineWidth(BORDER_WIDTH);
    cr.rectangle(sel.x, sel.y, sel.width, sel.height);
    cr.stroke();

    // Corner handles
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
    cr.rectangle(
        tx - pad,
        y - ext.height + pad,
        ext.width + pad * 2,
        ext.height + pad
    );
    cr.setSourceRGBA(0, 0, 0, bgAlpha);
    cr.fill();
    cr.moveTo(tx, y);
    cr.setSourceRGBA(1, 1, 1, fgAlpha);
    cr.showText(text);
}

function drawRegion(
    cr: Cairo.Context,
    w: number,
    h: number,
    state: SelectorState
) {
    const sel = getNormalizedSelection(state.selStart(), state.selEnd());

    dimBackground(cr, w, h, sel);
    drawWindowHints(cr, state.windows(), state.monOrigin(), w, h);

    if (!sel) return;

    drawSelectionRect(cr, sel);

    // Dimension label below the selection
    drawLabel(
        cr,
        `${sel.width} × ${sel.height}`,
        sel.x + sel.width / 2,
        sel.y + sel.height + 24,
        Cairo.FontWeight.BOLD,
        0.6,
        DIM_TEXT_COLOR.a
    );

    // Hint text at bottom
    drawLabel(
        cr,
        'Drag to select · Click a window to snap · Enter to confirm · Esc to cancel',
        w / 2,
        h - 32,
        Cairo.FontWeight.NORMAL,
        0.5,
        0.7
    );
}

// ── Mouse handlers ──────────────────────────────────────────────

function onDragBegin(state: SelectorState, sx: number, sy: number) {
    state.setSelStart({x: sx, y: sy});
    state.setSelEnd({x: sx, y: sy});
    state.daRef.current?.queue_draw();
}

function onDragUpdate(state: SelectorState, ox: number, oy: number) {
    const s = state.selStart();
    if (s) state.setSelEnd({x: s.x + ox, y: s.y + oy});
    state.daRef.current?.queue_draw();
}

function onClickPressed(state: SelectorState, cx: number, cy: number) {
    const wins = state.windows();
    const o = state.monOrigin();
    // Click coords are local to the monitor; windows are in global coords.
    const gx = cx + o.x;
    const gy = cy + o.y;
    // Check window snap
    for (const win of wins) {
        if (
            gx >= win.x &&
            gx <= win.x + win.width &&
            gy >= win.y &&
            gy <= win.y + win.height
        ) {
            // Store LOCAL coords so drawing stays correct; the global
            // offset is re-added at capture time.
            state.setSelStart({x: win.x - o.x, y: win.y - o.y});
            state.setSelEnd({
                x: win.x + win.width - o.x,
                y: win.y + win.height - o.y,
            });
            state.daRef.current?.queue_draw();
            return;
        }
    }
    // Click outside — confirm existing selection
    const sel = getNormalizedSelection(state.selStart(), state.selEnd());
    if (sel) confirmSelection(state);
}

// ── Keyboard ────────────────────────────────────────────────────

function handleKey(state: SelectorState, keyval: number): boolean {
    if (keyval === Gdk.KEY_Escape) {
        cancelSelection(state);
        return true;
    }
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
        confirmSelection(state);
        return true;
    }
    return false;
}

// ── Component ───────────────────────────────────────────────────

export default () => {
    const ss = Screenshot.get_default();
    const hyprland = getHyprland();
    if (!hyprland) return null;

    // Global origin of the monitor the selector covers. Drag/click coords are
    // local to that monitor, but grim/wl-screenrec -g (without -o) expect
    // global compositor coords — so we add this offset when capturing and
    // subtract it when drawing global window geometry.
    const [selStart, setSelStart] = createState<Point | null>(null);
    const [selEnd, setSelEnd] = createState<Point | null>(null);
    const [windows, setWindows] = createState<WindowGeometry[]>([]);
    const [monOrigin, setMonOrigin] = createState<Point>({x: 0, y: 0});

    const state: SelectorState = {
        selStart,
        setSelStart,
        selEnd,
        setSelEnd,
        windows,
        monOrigin,
        daRef: {current: null},
    };

    return (
        <Astal.Window
            name={'region-selector'}
            application={getApp()}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.EXCLUSIVE}
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={bind(ss, 'regionSelectorOpen')}
            onNotifyVisible={self => {
                if (self.visible) {
                    const mon = hyprland.focusedMonitor;
                    if (mon) {
                        setMonOrigin({x: mon.x, y: mon.y});
                    }
                    setSelStart(null);
                    setSelEnd(null);
                    setWindows(getWindowGeometries());
                }
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={bind(hyprland, 'focused-monitor').as(
                monitorIndexFromHyprland
            )}
            css={'background-color: transparent;'}
        >
            <Gtk.Overlay>
                <Gtk.DrawingArea
                    ref={self => {
                        state.daRef.current = self;
                        self.set_draw_func((_a, cr, w, h) =>
                            drawRegion(cr, w, h, state)
                        );
                    }}
                    hexpand
                    vexpand
                >
                    <Gtk.GestureDrag
                        ref={self => {
                            self.connect('drag-begin', (_g, sx, sy) =>
                                onDragBegin(state, sx, sy)
                            );
                            self.connect('drag-update', (_g, ox, oy) =>
                                onDragUpdate(state, ox, oy)
                            );
                            self.connect('drag-end', (_g, ox, oy) =>
                                onDragUpdate(state, ox, oy)
                            );
                        }}
                    />
                    <Gtk.GestureClick
                        ref={self => {
                            self.set_button(1);
                            self.connect('pressed', (_g, _n, cx, cy) =>
                                onClickPressed(state, cx, cy)
                            );
                        }}
                    />
                </Gtk.DrawingArea>

                <Gtk.EventControllerKey
                    ref={self =>
                        self.connect('key-pressed', (_c, keyval) =>
                            handleKey(state, keyval)
                        )
                    }
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};