import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {getHyprland} from '@shade/services/hyprland';
import {Accessor, bind, createState} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import logger from '@shade/core/logger';
import {draw} from './drawing';
import {ControlPanel} from './controlPanel';
import {
    normalizeRect,
    isScreenshotMode,
    buildGeometry,
    windowAt,
    loadWindows,
    getMonitorOrigin,
    type Point,
    type WinInfo,
    type SelectionState,
} from './selection';

const LOG_TAG = 'screenshot-ui';

// ── State ─────────────────────────────────────────────────────────

type Hyprland = NonNullable<ReturnType<typeof getHyprland>>;

/** Mutable overlay state shared by the input/capture handlers. */
interface OverlayState {
    hyprland: Hyprland;
    ss: Screenshot;
    dragStart: Accessor<Point | null>;
    setDragStart: (v: Point | null) => void;
    dragEnd: Accessor<Point | null>;
    setDragEnd: (v: Point | null) => void;
    selActive: Accessor<boolean>;
    setSelActive: (v: boolean) => void;
    selectedWindow: Accessor<WinInfo | null>;
    setSelectedWindow: (v: WinInfo | null) => void;
    windows: Accessor<WinInfo[]>;
    setWindows: (v: WinInfo[]) => void;
    monOrigin: Accessor<Point>;
    setMonOrigin: (v: Point) => void;
    daRef: {current: Gtk.DrawingArea | null};
}

function getSelectionState(state: OverlayState): SelectionState {
    const mon = state.hyprland.focusedMonitor;
    return {
        dragStart: state.dragStart(),
        dragEnd: state.dragEnd(),
        selActive: state.selActive(),
        selectedWindow: state.selectedWindow(),
        windows: state.windows(),
        monOrigin: state.monOrigin(),
        focusedMonitor: mon
            ? {x: mon.x, y: mon.y, width: mon.width, height: mon.height}
            : null,
    };
}

function resetSelection(state: OverlayState) {
    state.setDragStart(null);
    state.setDragEnd(null);
    state.setSelActive(false);
    state.setSelectedWindow(null);
}

// ── Event handlers ────────────────────────────────────────────────

function onDragBegin(state: OverlayState, sx: number, sy: number) {
    if (state.ss.selectedTarget !== 'area') return;
    state.setDragStart({x: sx, y: sy});
    state.setDragEnd({x: sx, y: sy});
    state.setSelActive(true);
    state.setSelectedWindow(null);
    state.daRef.current?.queue_draw();
}

function onDragUpdate(state: OverlayState, ox: number, oy: number) {
    if (!state.selActive()) return;
    const s = state.dragStart();
    if (s) {
        state.setDragEnd({x: s.x + ox, y: s.y + oy});
        state.daRef.current?.queue_draw();
    }
}

function onDragEnd(state: OverlayState) {
    if (!state.selActive()) return;
    const s = normalizeRect(state.dragStart()!, state.dragEnd()!);
    if (s.width < 5 || s.height < 5) resetSelection(state);
    state.daRef.current?.queue_draw();
}

/**
 * Click behavior unified across targets:
 * - hit a window → area mode selects its rect; window mode selects the window.
 * - miss in quick mode with an existing selection → confirm immediately
 *   (this is the region-selector's click-outside-to-confirm behavior).
 */
function onClickPressed(state: OverlayState, cx: number, cy: number) {
    const hit = windowAt(state.windows(), cx, cy, state.monOrigin());
    if (hit) {
        if (state.ss.selectedTarget === 'window') {
            state.setSelectedWindow(hit);
        } else if (state.ss.selectedTarget === 'area') {
            state.setDragStart({x: hit.x - state.monOrigin().x, y: hit.y - state.monOrigin().y});
            state.setDragEnd({x: hit.x + hit.width - state.monOrigin().x, y: hit.y + hit.height - state.monOrigin().y});
            state.setSelActive(true);
            state.setSelectedWindow(null);
        }
        state.daRef.current?.queue_draw();
        return;
    }

    if (state.ss.overlayQuick) {
        const geom = buildGeometry(state.ss.selectedTarget, getSelectionState(state));
        if (geom) state.ss.confirmOverlay('area', geom);
    }
}

/** Confirm the current selection: crop from stage (screenshot) or record. */
function executeCapture(state: OverlayState) {
    const target = state.ss.selectedTarget;
    const geom = buildGeometry(target, getSelectionState(state));

    if (
        (target === 'area' && !state.selActive()) ||
        (target === 'window' && !state.selectedWindow())
    )
        return;

    const geomLabel = geom
        ? `${geom.width}x${geom.height}+${geom.x}+${geom.y}`
        : 'full';
    logger.info(
        LOG_TAG,
        `capture: mode=${state.ss.selectedMode}, target=${target}, geom=${geomLabel}`
    );

    state.ss.confirmOverlay(target, geom);
}

function handleKey(state: OverlayState, keyval: number): boolean {
    if (keyval === Gdk.KEY_Escape) {
        state.ss.hideOverlay();
        return true;
    }
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
        executeCapture(state);
        return true;
    }
    return false;
}

function handleTargetChange(state: OverlayState, value: string) {
    if (value === 'window' || value === 'area') {
        state.setWindows(loadWindows(state.hyprland.get_clients()));
    }
    state.daRef.current?.queue_draw();
}

// ── Sub-widgets ───────────────────────────────────────────────────

/**
 * Frozen background picture in screenshot mode (reactive), else a
 * transparent box. Reads `stageTexture` via bind so the backdrop appears
 * once the stage capture lands.
 */
function OverlayBackground({ss}: {ss: Screenshot}) {
    // Stage texture is the reactive trigger (arrives after captureSync on
    // overlay open); mode is peeked for the screenshot/recording switch.
    return bind(ss, 'stageTexture').as(tex =>
        tex && isScreenshotMode(ss.selectedMode) ? (
            <Gtk.Picture
                paintable={tex}
                hexpand
                vexpand
                canShrink={false}
                contentFit={Gtk.ContentFit.FILL}
            />
        ) : (
            <Gtk.Box hexpand vexpand />
        )
    );
}

/** DrawingArea overlay with drag/click gestures for region selection. */
function SelectionArea({state}: {state: OverlayState}) {
    return (
        <Gtk.DrawingArea
            ref={self => {
                state.daRef.current = self;
                self.set_draw_func((_da, cr, w, h) =>
                    draw(_da, cr, w, h, {
                        ss: state.ss,
                        selActive: state.selActive(),
                        dragStart: state.dragStart(),
                        dragEnd: state.dragEnd(),
                        selectedWindow: state.selectedWindow(),
                        windows: state.windows(),
                        monOrigin: state.monOrigin(),
                    })
                );
            }}
            hexpand
            vexpand
            css={'background: transparent;'}
        >
            <Gtk.GestureDrag
                ref={self => {
                    self.connect('drag-begin', (_g, sx, sy) =>
                        onDragBegin(state, sx, sy)
                    );
                    self.connect('drag-update', (_g, ox, oy) =>
                        onDragUpdate(state, ox, oy)
                    );
                    self.connect('drag-end', () => onDragEnd(state));
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
    );
}

// ── Widget ────────────────────────────────────────────────────────

export default () => {
    const ss = Screenshot.get_default();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const isVisible = bind(ss, 'overlayOpen');

    const [dragStart, setDragStart] = createState<Point | null>(null);
    const [dragEnd, setDragEnd] = createState<Point | null>(null);
    const [selActive, setSelActive] = createState(false);
    const [selectedWindow, setSelectedWindow] = createState<WinInfo | null>(
        null
    );
    const [windows, setWindows] = createState<WinInfo[]>([]);
    const [monOrigin, setMonOrigin] = createState<Point>({x: 0, y: 0});

    const state: OverlayState = {
        hyprland,
        ss,
        dragStart,
        setDragStart,
        dragEnd,
        setDragEnd,
        selActive,
        setSelActive,
        selectedWindow,
        setSelectedWindow,
        windows,
        setWindows,
        monOrigin,
        setMonOrigin,
        daRef: {current: null},
    };

    return (
        <Astal.Window
            ref={self => WindowManager.get_default().setOverlay(self)}
            name={LOG_TAG}
            application={getApp()}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.EXCLUSIVE}
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={isVisible}
            onNotifyVisible={self => {
                if (self.visible) {
                    setMonOrigin(getMonitorOrigin(hyprland.focusedMonitor));
                    setWindows(loadWindows(hyprland.get_clients()));
                }
                resetSelection(state);
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
                <OverlayBackground ss={ss} />
                <SelectionArea state={state} />

                {/* Control panel — hidden in quick-select mode */}
                {bind(ss, 'overlayQuick').as(
                    q =>
                        !q && (
                            <ControlPanel
                                ss={ss}
                                onCapture={() => executeCapture(state)}
                                onReset={() => resetSelection(state)}
                                onTargetChange={v => handleTargetChange(state, v)}
                            />
                        )
                )}

                {/* Keyboard handler */}
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