import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Cairo from 'gi://cairo?version=1.0';
import {createBinding, createState} from 'gnim';
import {app} from '#/App';
import {Process} from '#/lib/process';
import Screenshot from '#/lib/screenshot';
import logger from '#/lib/logger';

interface WindowGeometry {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

// ── Constants ───────────────────────────────────────────────────

const DIM_COLOR = {r: 0, g: 0, b: 0, a: 0.35};
const BORDER_COLOR = {r: 0.21, g: 0.51, b: 0.89, a: 1.0}; // #3584e4
const BORDER_WIDTH = 2;
const HANDLE_SIZE = 8;
const WINDOW_HINT_COLOR = {r: 1, g: 1, b: 1, a: 0.15};
const DIM_TEXT_COLOR = {r: 1, g: 1, b: 1, a: 0.9};

// ── Helpers ─────────────────────────────────────────────────────

function getNormalizedSelection(
    start: {x: number; y: number} | null,
    end: {x: number; y: number} | null
): {x: number; y: number; width: number; height: number} | null {
    if (!start || !end) return null;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if (w < 5 && h < 5) return null;
    return {x, y, width: w, height: h};
}

// ── Component ───────────────────────────────────────────────────

export default () => {
    const ss = Screenshot.get_default();
    const hyprland = AstalHyprland.get_default();
    const [selStart, setSelStart] = createState<{x: number; y: number} | null>(
        null
    );
    const [selEnd, setSelEnd] = createState<{x: number; y: number} | null>(
        null
    );
    const [windows, setWindows] = createState<WindowGeometry[]>([]);

    // Global origin of the monitor the selector covers. Drag/click coords are
    // local to that monitor, but grim/wl-screenrec -g (without -o) expect
    // global compositor coords — so we add this offset when capturing and
    // subtract it when drawing global window geometry.
    const [monOrigin, setMonOrigin] = createState<{x: number; y: number}>({
        x: 0,
        y: 0,
    });

    // ── Confirm / Cancel ─────────────────────────────────────────

    const confirmSelection = () => {
        const sel = getNormalizedSelection(selStart(), selEnd());
        if (!sel) return;
        const o = monOrigin();
        const geometry = `${sel.x + o.x},${sel.y + o.y} ${sel.width}x${sel.height}`;
        ss.captureArea(geometry);
    };

    const cancelSelection = () => {
        setSelStart(null);
        setSelEnd(null);
        ss.regionSelectorOpen = false;
    };

    // ── Window discovery ─────────────────────────────────────────

    const loadWindows = () => {
        try {
            const json = Process.exec('hyprctl clients -j');
            const clients = JSON.parse(json);
            const wins: WindowGeometry[] = [];
            for (const c of clients) {
                if (c.mapped && c.monitor >= 0 && c.at && c.size) {
                    wins.push({
                        address: c.address,
                        x: c.at[0],
                        y: c.at[1],
                        width: c.size[0],
                        height: c.size[1],
                        title: c.title || '(untitled)',
                    });
                }
            }
            setWindows(wins);
        } catch (e) {
            logger.warn('region-selector', 'failed to load windows:', e);
        }
    };

    // ── Drawing ──────────────────────────────────────────────────

    const draw = (
        _area: Gtk.DrawingArea,
        cr: Cairo.Context,
        w: number,
        h: number
    ) => {
        const sel = getNormalizedSelection(selStart(), selEnd());

        // ── Dim background ────────────────────────────────────────
        if (sel) {
            // Draw 4 rectangles around selection to dim everything except it
            cr.rectangle(0, 0, w, sel.y);
            cr.rectangle(0, sel.y + sel.height, w, h - sel.y - sel.height);
            cr.rectangle(0, sel.y, sel.x, sel.height);
            cr.rectangle(
                sel.x + sel.width,
                sel.y,
                w - sel.x - sel.width,
                sel.height
            );
            cr.setSourceRGBA(
                DIM_COLOR.r,
                DIM_COLOR.g,
                DIM_COLOR.b,
                DIM_COLOR.a
            );
            cr.fill();
        } else {
            cr.rectangle(0, 0, w, h);
            cr.setSourceRGBA(
                DIM_COLOR.r,
                DIM_COLOR.g,
                DIM_COLOR.b,
                DIM_COLOR.a
            );
            cr.fill();
        }

        // ── Window hints ──────────────────────────────────────────
        const wins = windows();
        cr.setSourceRGBA(
            WINDOW_HINT_COLOR.r,
            WINDOW_HINT_COLOR.g,
            WINDOW_HINT_COLOR.b,
            WINDOW_HINT_COLOR.a
        );
        cr.setLineWidth(1);
        const o = monOrigin();
        for (const win of wins) {
            const lx = win.x - o.x;
            const ly = win.y - o.y;
            if (lx < w && ly < h) {
                cr.rectangle(lx, ly, win.width, win.height);
                cr.stroke();
            }
        }

        // ── Selection rectangle ───────────────────────────────────
        if (!sel) return;

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

        // Dimension label
        const label = `${sel.width} × ${sel.height}`;
        cr.selectFontFace(
            'sans-serif',
            Cairo.FontSlant.NORMAL,
            Cairo.FontWeight.BOLD
        );
        cr.setFontSize(13);
        const ext = cr.textExtents(label);
        const tx = sel.x + sel.width / 2 - ext.width / 2;
        const ty = sel.y + sel.height + 24;
        const pad = 4;
        cr.rectangle(
            tx - pad,
            ty - ext.height + pad,
            ext.width + pad * 2,
            ext.height + pad
        );
        cr.setSourceRGBA(0, 0, 0, 0.6);
        cr.fill();
        cr.moveTo(tx, ty);
        cr.setSourceRGBA(
            DIM_TEXT_COLOR.r,
            DIM_TEXT_COLOR.g,
            DIM_TEXT_COLOR.b,
            DIM_TEXT_COLOR.a
        );
        cr.showText(label);

        // Hint text at bottom
        const hint =
            'Drag to select · Click a window to snap · Enter to confirm · Esc to cancel';
        cr.selectFontFace(
            'sans-serif',
            Cairo.FontSlant.NORMAL,
            Cairo.FontWeight.NORMAL
        );
        cr.setFontSize(12);
        const hExt = cr.textExtents(hint);
        const hx = w / 2 - hExt.width / 2;
        const hy = h - 32;
        cr.rectangle(
            hx - pad,
            hy - hExt.height + pad,
            hExt.width + pad * 2,
            hExt.height + pad
        );
        cr.setSourceRGBA(0, 0, 0, 0.5);
        cr.fill();
        cr.moveTo(hx, hy);
        cr.setSourceRGBA(1, 1, 1, 0.7);
        cr.showText(hint);
    };

    // ── Mouse handlers ───────────────────────────────────────────

    const onDragBegin = (_g: Gtk.GestureDrag, sx: number, sy: number) => {
        setSelStart({x: sx, y: sy});
        setSelEnd({x: sx, y: sy});
    };

    const onDragUpdate = (_g: Gtk.GestureDrag, ox: number, oy: number) => {
        const s = selStart();
        if (s) setSelEnd({x: s.x + ox, y: s.y + oy});
    };

    const onDragEnd = (_g: Gtk.GestureDrag, ox: number, oy: number) => {
        const s = selStart();
        if (s) setSelEnd({x: s.x + ox, y: s.y + oy});
    };

    const onClickPressed = (
        _g: Gtk.GestureClick,
        _n: number,
        cx: number,
        cy: number
    ) => {
        const wins = windows();
        const o = monOrigin();
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
                setSelStart({x: win.x - o.x, y: win.y - o.y});
                setSelEnd({
                    x: win.x + win.width - o.x,
                    y: win.y + win.height - o.y,
                });
                return;
            }
        }
        // Click outside — confirm existing selection
        const sel = getNormalizedSelection(selStart(), selEnd());
        if (sel) confirmSelection();
    };

    // ── Keyboard ─────────────────────────────────────────────────

    const handleKey = (_ctrl: Gtk.EventControllerKey, keyval: number) => {
        if (keyval === Gdk.KEY_Escape) {
            cancelSelection();
            return true;
        }
        if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
            confirmSelection();
            return true;
        }
        return false;
    };

    return (
        <Astal.Window
            name={'region-selector'}
            application={app}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.EXCLUSIVE}
            visible={createBinding(ss, 'region-selector-open')}
            onNotifyVisible={self => {
                if (self.visible) {
                    const mon = hyprland.focused_monitor;
                    if (mon) {
                        setMonOrigin({x: mon.x, y: mon.y});
                    }
                    setSelStart(null);
                    setSelEnd(null);
                    loadWindows();
                }
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={createBinding(hyprland, 'focusedMonitor').as(m => m.id)}
            css={'background-color: transparent;'}
        >
            <Gtk.Overlay>
                <Gtk.DrawingArea
                    $={self => self.set_draw_func(draw)}
                    hexpand
                    vexpand
                >
                    <Gtk.GestureDrag
                        $={self => {
                            self.connect('drag-begin', onDragBegin);
                            self.connect('drag-update', onDragUpdate);
                            self.connect('drag-end', onDragEnd);
                        }}
                    />
                    <Gtk.GestureClick
                        $={self => {
                            self.set_button(1);
                            self.connect('pressed', onClickPressed);
                        }}
                    />
                </Gtk.DrawingArea>

                <Gtk.EventControllerKey
                    $={self => self.connect('key-pressed', handleKey)}
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};
