import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'gi://cairo?version=1.0';
import Adw from 'gi://Adw?version=1';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {createBinding, createState} from 'gnim';
import {app} from '#/App';
import Screenshot from '#/lib/services/capture/screenshot';
import WindowManager from '#/lib/services/state/windowManager';
import {LinkedBox} from '#/widget/common/linkedBox';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';
import {gdkMonitorFromHyprland} from '#/lib/utils/monitors';
import logger from '#/lib/core/logger';

// ── Constants ─────────────────────────────────────────────────────

const DIM_COLOR = {r: 0, g: 0, b: 0, a: 0.35};
const MIN_SELECTION = 5;
const OVERLAY_CLOSE_DELAY_MS = 150;

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

// ── Widget ────────────────────────────────────────────────────────

export default () => {
    const ss = Screenshot.get_default();
    const hyprland = AstalHyprland.get_default();
    const captureSettings = getScreenCaptureSettings();

    // Local reactive state
    const [dragStart, setDragStart] = createState<Point | null>(null);
    const [dragEnd, setDragEnd] = createState<Point | null>(null);
    const [selActive, setSelActive] = createState(false);
    const [selectedWindow, setSelectedWindow] = createState<WinInfo | null>(
        null
    );
    const [windows, setWindows] = createState<WinInfo[]>([]);
    const [monOrigin, setMonOrigin] = createState<Point>({x: 0, y: 0});

    // DrawingArea reference for queue_draw
    let daRef: Gtk.DrawingArea | null = null;

    // ── State helpers ─────────────────────────────────────────────

    function resetSelection() {
        setDragStart(null);
        setDragEnd(null);
        setSelActive(false);
        setSelectedWindow(null);
    }

    function loadWindows() {
        const clients = hyprland.get_clients();
        const list: WinInfo[] = [];
        for (let i = 0; i < clients.length; i++) {
            const c = clients[i];
            const addr = c.address;
            const w = c.width;
            const h = c.height;
            if (w > 0 && h > 0) {
                list.push({
                    address: addr,
                    x: c.x,
                    y: c.y,
                    width: w,
                    height: h,
                    title: c.title,
                });
            }
        }
        setWindows(list);
    }

    function updateMonOrigin() {
        const m = hyprland.focused_monitor;
        if (m) {
            setMonOrigin({x: m.x, y: m.y});
        }
    }

    function isScreenshotMode(): boolean {
        return ss.selectedMode === 'screenshot';
    }

    // ── Drawing ───────────────────────────────────────────────────

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

    function draw(
        _da: Gtk.DrawingArea,
        cr: Cairo.Context,
        width: number,
        height: number
    ) {
        const target = ss.selectedTarget;
        const sel = selActive() ? normalizeRect(dragStart()!, dragEnd()!) : null;
        const sWin = selectedWindow();
        const winL = windows();

        // ── Dim overlay ──────────────────────────────────────────
        // Draw dim rectangles around the active selection/window.
        // In screenshot mode the frozen bg is already displayed below,
        // so this dims the frozen frame around the capture area.
        // In recording mode the live screen shows through, so this
        // dims the live area to highlight the selection.
        cr.setSourceRGBA(
            DIM_COLOR.r,
            DIM_COLOR.g,
            DIM_COLOR.b,
            DIM_COLOR.a
        );

        if (target === 'area' && sel && sel.width >= MIN_SELECTION) {
            // Four dim rectangles around the selection
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
            const origin = monOrigin();
            const lx = sWin.x - origin.x;
            const ly = sWin.y - origin.y;
            // Dim around the window
            drawDimRect(cr, 0, 0, width, ly);
            drawDimRect(
                cr,
                0,
                ly + sWin.height,
                width,
                height - ly - sWin.height
            );
            drawDimRect(cr, 0, ly, lx, sWin.height);
            drawDimRect(
                cr,
                lx + sWin.width,
                ly,
                width - lx - sWin.width,
                sWin.height
            );
        } else if (target === 'monitor') {
            const m = hyprland.focused_monitor;
            if (m) {
                const origin = monOrigin();
                const lx = m.x - origin.x;
                const ly = m.y - origin.y;
                drawDimRect(cr, 0, 0, width, ly);
                drawDimRect(
                    cr,
                    0,
                    ly + m.height,
                    width,
                    height - ly - m.height
                );
                drawDimRect(cr, 0, ly, lx, m.height);
                drawDimRect(
                    cr,
                    lx + m.width,
                    ly,
                    width - lx - m.width,
                    m.height
                );
            }
        } else if (target !== 'fullscreen') {
            // No selection yet — full dim
            cr.rectangle(0, 0, width, height);
        }
        cr.fill();

        // ── Window outlines ──────────────────────────────────────
        if (target === 'window') {
            const origin = monOrigin();
            cr.setLineWidth(2);
            cr.setSourceRGBA(1, 1, 1, 0.4);

            for (const w of winL) {
                const lx = w.x - origin.x;
                const ly = w.y - origin.y;
                cr.rectangle(lx, ly, w.width, w.height);
            }
            cr.stroke();

            // Highlight selected window
            if (sWin) {
                const lx = sWin.x - origin.x;
                const ly = sWin.y - origin.y;
                cr.setLineWidth(4);
                cr.setSourceRGBA(0.3, 0.6, 1, 0.9);
                cr.rectangle(lx, ly, sWin.width, sWin.height);
                cr.stroke();

                // Title
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
            // Selection border
            cr.setLineWidth(2);
            cr.setSourceRGBA(0.3, 0.6, 1, 0.9);
            cr.rectangle(sel.x, sel.y, sel.width, sel.height);
            cr.stroke();

            // Dimension label
            const label = `${sel.width}×${sel.height}`;
            const labelX = sel.x + 4;
            const labelY = sel.y - 6;

            // Label background
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
        if (!selActive() && target === 'area') {
            const text = 'Drag to select an area';
            cr.setSourceRGBA(1, 1, 1, 0.7);
            cr.setFontSize(14);
            const ext = cr.textExtents(text);
            cr.moveTo(
                (width - ext.width) / 2,
                height / 2 - ext.y_bearing
            );
            cr.showText(text);
        }
        if (!sWin && target === 'window') {
            const text = 'Click a window to select it';
            cr.setSourceRGBA(1, 1, 1, 0.7);
            cr.setFontSize(14);
            const ext = cr.textExtents(text);
            cr.moveTo(
                (width - ext.width) / 2,
                height / 2 - ext.y_bearing
            );
            cr.showText(text);
        }
    }

    // ── Event handlers ────────────────────────────────────────────

    const onDragBegin = (_g: Gtk.GestureDrag, sx: number, sy: number) => {
        if (ss.selectedTarget !== 'area') return;
        setDragStart({x: sx, y: sy});
        setDragEnd({x: sx, y: sy});
        setSelActive(true);
        setSelectedWindow(null);
        daRef?.queue_draw();
    };

    const onDragUpdate = (
        _g: Gtk.GestureDrag,
        ox: number,
        oy: number
    ) => {
        if (!selActive()) return;
        const s = dragStart();
        if (s) {
            setDragEnd({x: s.x + ox, y: s.y + oy});
            daRef?.queue_draw();
        }
    };

    const onDragEnd = (_g: Gtk.GestureDrag, _ox: number, _oy: number) => {
        if (!selActive()) return;
        // Final validation — if too small, reset
        const sel = normalizeRect(dragStart()!, dragEnd()!);
        if (sel.width < MIN_SELECTION || sel.height < MIN_SELECTION) {
            resetSelection();
        }
        daRef?.queue_draw();
    };

    const onClickPressed = (
        _g: Gtk.GestureClick,
        _nPress: number,
        clickX: number,
        clickY: number
    ) => {
        if (ss.selectedTarget !== 'window') return;
        const origin = monOrigin();
        const globalX = clickX + origin.x;
        const globalY = clickY + origin.y;

        // Hit-test windows (front-to-back would need z-order, but
        // Hyprland window stacking is close-enough to list order)
        const winL = windows();
        for (let i = winL.length - 1; i >= 0; i--) {
            const w = winL[i];
            if (
                globalX >= w.x &&
                globalX <= w.x + w.width &&
                globalY >= w.y &&
                globalY <= w.y + w.height
            ) {
                setSelectedWindow(w);
                daRef?.queue_draw();
                return;
            }
        }
    };

    const handleKey = (
        _ctrl: Gtk.EventControllerKey,
        keyval: number
    ): boolean => {
        if (keyval === Gdk.KEY_Escape) {
            ss.overlayOpen = false;
            return true;
        }
        if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
            executeCapture();
            return true;
        }
        return false;
    };

    // ── Capture / Recording ───────────────────────────────────────

    function buildGeometry(): string | null {
        const target = ss.selectedTarget;

        if (target === 'fullscreen') return null;

        if (target === 'area') {
            if (!selActive()) return null;
            const sel = normalizeRect(dragStart()!, dragEnd()!);
            if (sel.width < MIN_SELECTION || sel.height < MIN_SELECTION)
                return null;
            const origin = monOrigin();
            return `${sel.width}x${sel.height}+${sel.x + origin.x}+${sel.y + origin.y}`;
        }

        if (target === 'window') {
            const sWin = selectedWindow();
            if (!sWin) return null;
            return `${sWin.width}x${sWin.height}+${sWin.x}+${sWin.y}`;
        }

        if (target === 'monitor') {
            const m = hyprland.focused_monitor;
            if (!m) return null;
            return `${m.width}x${m.height}+${m.x}+${m.y}`;
        }

        return null;
    }

    function executeCapture() {
        const mode = ss.selectedMode;
        const target = ss.selectedTarget;
        const geometry = buildGeometry();

        logger.info(
            'screenshot-ui',
            `capture: mode=${mode}, target=${target}, geom=${geometry ?? 'full'}`
        );

        if (target === 'area' && !selActive()) {
            // No selection drawn yet — ignore capture
            return;
        }
        if (target === 'window' && !selectedWindow()) {
            // No window selected
            return;
        }

        if (mode === 'screenshot') {
            // Screenshot: crop from frozen stage (no overlay close delay needed)
            ss.captureFromStage(geometry);
        } else {
            // Recording: close overlay first, then start recording.
            // The 150ms delay lets the overlay window unmap so
            // wf-recorder/wl-screenrec don't capture the overlay itself.
            ss.overlayOpen = false;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, OVERLAY_CLOSE_DELAY_MS, () => {
                if (target === 'fullscreen' && !geometry) {
                    ss.toggleRecording();
                } else if (geometry) {
                    ss.startRecording({geometry});
                    ss.stopFreeze();
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // ── Mode / Target button helpers ──────────────────────────────

    const ModeTab = ({
        label,
        value,
        icon,
    }: {
        label: string;
        value: 'screenshot' | 'recording';
        icon: string;
    }) => (
        <Gtk.ToggleButton
            active={createBinding(ss, 'selected-mode').as(
                m => m === value
            )}
            onToggled={btn => {
                if (btn.active) {
                    resetSelection();
                    ss.selectedMode = value;
                }
            }}
            hexpand
        >
            <Adw.ButtonContent iconName={icon} label={label} />
        </Gtk.ToggleButton>
    );

    const TargetButton = ({
        label,
        value,
        icon,
    }: {
        label: string;
        value: 'fullscreen' | 'area' | 'window' | 'monitor';
        icon: string;
    }) => (
        <Gtk.ToggleButton
            active={createBinding(ss, 'selected-target').as(
                t => t === value
            )}
            onToggled={btn => {
                if (btn.active) {
                    resetSelection();
                    ss.selectedTarget = value;
                    if (value === 'window') loadWindows();
                    daRef?.queue_draw();
                }
            }}
            hexpand
        >
            <Adw.ButtonContent iconName={icon} label={label} />
        </Gtk.ToggleButton>
    );

    // ── Render ────────────────────────────────────────────────────

    return (
        <Astal.Window
            $={self => {
                WindowManager.get_default().setOverlay(self);
            }}
            name={'screenshot-ui'}
            application={app}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.EXCLUSIVE}
            visible={createBinding(ss, 'overlay-open')}
            onNotifyVisible={self => {
                if (self.visible) {
                    // Update state when overlay opens
                    updateMonOrigin();
                    loadWindows();
                    resetSelection();
                    logger.info('screenshot-ui', 'overlay opened');
                } else {
                    resetSelection();
                }
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            gdkmonitor={createBinding(hyprland, 'focusedMonitor').as(
                gdkMonitorFromHyprland
            )}
            css={'background-color: transparent;'}
        >
            <Gtk.Overlay>
                {/* ── Main child: frozen background OR empty ───── */}
                {isScreenshotMode() && ss.stageTexture ? (
                    <Gtk.Picture
                        paintable={ss.stageTexture}
                        hexpand
                        vexpand
                        canShrink={false}
                        contentFit={Gtk.ContentFit.FILL}
                    />
                ) : (
                    /* Recording mode: transparent box — live screen
                     * shows through the dim Cairo overlay */
                    <Gtk.Box hexpand vexpand />
                )}

                {/* ── Selection DrawingArea overlay ────────────── */}
                <Gtk.DrawingArea
                    $={self => {
                        daRef = self;
                        self.set_draw_func(draw);
                    }}
                    hexpand
                    vexpand
                    css={'background: transparent;'}
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

                {/* ── Control panel overlay (top center) ──────── */}
                <Gtk.Box
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.START}
                    hexpand={false}
                    vexpand={false}
                    css={'margin-top: 24px;'}
                >
                    <Gtk.Box
                        cssClasses={['card', 'frame', 'background']}
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={8}
                        css={'padding: 12px;'}
                    >
                        {/* Mode toggle */}
                        <Gtk.Box
                            spacing={4}
                            homogeneous
                            cssClasses={['linked']}
                        >
                            <ModeTab
                                label="Screenshot"
                                value="screenshot"
                                icon="camera-photo-symbolic"
                            />
                            <ModeTab
                                label="Record"
                                value="recording"
                                icon="camera-video-symbolic"
                            />
                        </Gtk.Box>

                        <Gtk.Separator />

                        {/* Target picker */}
                        <LinkedBox>
                            <TargetButton
                                label="Fullscreen"
                                value="fullscreen"
                                icon="video-display-symbolic"
                            />
                            <TargetButton
                                label="Area"
                                value="area"
                                icon="selection-mode-symbolic"
                            />
                            <TargetButton
                                label="Window"
                                value="window"
                                icon="focus-windows-symbolic"
                            />
                            <TargetButton
                                label="Monitor"
                                value="monitor"
                                icon="video-display-symbolic"
                            />
                        </LinkedBox>

                        <Gtk.Separator />

                        {/* Audio + Boundary options (recording) */}
                        {ss.selectedMode === 'recording' && (
                            <Gtk.Box spacing={12}>
                                <Gtk.CheckButton
                                    active={createBinding(ss, 'audio')}
                                    onNotifyActive={({active}) => {
                                        ss.audio = active;
                                    }}
                                >
                                    <Gtk.Label label="Audio" />
                                </Gtk.CheckButton>
                                <Gtk.CheckButton
                                    active={createBinding(
                                        captureSettings.settings,
                                        'show-recording-boundary'
                                    )}
                                    onNotifyActive={({active}) => {
                                        captureSettings.setShowRecordingBoundary(
                                            active
                                        );
                                    }}
                                >
                                    <Gtk.Label label="Boundary" />
                                </Gtk.CheckButton>
                            </Gtk.Box>
                        )}

                        <Gtk.Separator />

                        {/* Capture button */}
                        <Gtk.Button
                            onClicked={executeCapture}
                            cssClasses={['suggested-action']}
                            hexpand
                        >
                            <Adw.ButtonContent
                                iconName={createBinding(
                                    ss,
                                    'selected-mode'
                                ).as(m =>
                                    m === 'screenshot'
                                        ? 'camera-photo-symbolic'
                                        : 'camera-video-symbolic'
                                )}
                                label={createBinding(
                                    ss,
                                    'selected-mode'
                                ).as(m =>
                                    m === 'screenshot'
                                        ? 'Take Screenshot'
                                        : 'Start Recording'
                                )}
                            />
                        </Gtk.Button>

                        {/* Keyboard hint */}
                        <Gtk.Label
                            label="Esc to cancel  ·  Enter to capture"
                            halign={Gtk.Align.CENTER}
                            cssClasses={['caption']}
                            css={'opacity: 0.6;'}
                        />
                    </Gtk.Box>
                </Gtk.Box>

                {/* ── Keyboard handler ─────────────────────────── */}
                <Gtk.EventControllerKey
                    $={self => {
                        self.connect('key-pressed', handleKey);
                    }}
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};
