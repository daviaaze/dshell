import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import {getHyprland, getHyprlandClientSnapshot} from '@shade/services/hyprland';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, computed, createState} from 'gnim';
import {ControlPanel} from './controlPanel';
import {draw} from './drawing';
import {
    buildGeometry,
    getMonitorOrigin,
    isScreenshotMode,
    loadWindows,
    normalizeRect,
    type Point,
    type SelectionState,
    type WinInfo,
    windowAt,
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
    reviewing: Accessor<boolean>;
    setReviewing: (value: boolean) => void;
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
        focusedMonitor: mon ? {x: mon.x, y: mon.y, width: mon.width, height: mon.height} : null,
    };
}

function resetSelection(state: OverlayState) {
    state.setReviewing(false);
    state.setDragStart(null);
    state.setDragEnd(null);
    state.setSelActive(false);
    state.setSelectedWindow(null);
}

// ── Event handlers ────────────────────────────────────────────────
/** Resolve the actual canvas origin, including GTK allocation/border offsets. */
function updateCanvasOrigin(state: OverlayState): boolean {
    const canvas = state.daRef.current;
    const root = canvas?.get_root();
    const monitor = state.hyprland.focusedMonitor;
    if (!canvas || !(root instanceof Gtk.Window) || !monitor) return false;
    const [valid, x, y] = canvas.translate_coordinates(root, 0, 0);
    if (!valid) return false;
    const origin = getMonitorOrigin(monitor);
    state.setMonOrigin({x: origin.x + x, y: origin.y + y});
    return true;
}

function onDragBegin(state: OverlayState, sx: number, sy: number) {
    if (state.reviewing()) return;
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
    if (state.reviewing() || !state.selActive()) return;
    const s = normalizeRect(state.dragStart()!, state.dragEnd()!);
    if (s.width < 5 || s.height < 5) resetSelection(state);
    state.daRef.current?.queue_draw();
}

/** Source clicks only select; capture requires the review action. */
function onClickPressed(state: OverlayState, cx: number, cy: number) {
    if (state.reviewing()) return;
    const hit = windowAt(state.windows(), cx, cy, state.monOrigin());
    if (hit) {
        if (state.ss.selectedTarget === 'window') {
            state.setSelectedWindow(hit);
        } else if (state.ss.selectedTarget === 'area') {
            state.setDragStart({x: hit.x - state.monOrigin().x, y: hit.y - state.monOrigin().y});
            state.setDragEnd({
                x: hit.x + hit.width - state.monOrigin().x,
                y: hit.y + hit.height - state.monOrigin().y,
            });
            state.setSelActive(true);
            state.setSelectedWindow(null);
        }
        state.daRef.current?.queue_draw();
        return;
    }
}

function reviewCurrentSelection(state: OverlayState) {
    if (state.reviewing()) return;
    const target = state.ss.selectedTarget;
    const geometry = buildGeometry(target, getSelectionState(state));
    if (target !== 'fullscreen' && !geometry) return;
    state.setReviewing(true);
}

/** Confirm the current selection: crop from stage (screenshot) or record. */
function executeCapture(state: OverlayState) {
    if (!state.reviewing() || state.ss.captureBusy) return;
    const target = state.ss.selectedTarget;
    const geom = buildGeometry(target, getSelectionState(state));
    if (target !== 'fullscreen' && !geom) {
        state.setReviewing(false);
        return;
    }
    const geomLabel = geom ? `${geom.width}x${geom.height}+${geom.x}+${geom.y}` : 'full';
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
        if (!state.reviewing()) reviewCurrentSelection(state);
        return true;
    }
    // Enter never commits capture: the explicit review/confirm controls own consent.
    return false;
}

function handleTargetChange(state: OverlayState, value: string) {
    if (state.reviewing()) return;
    if (value === 'window' || value === 'area') {
        try {
            state.setWindows(loadWindows(getHyprlandClientSnapshot()));
        } catch (error) {
            logger.error(LOG_TAG, `failed to refresh window geometry: ${error}`);
            state.setWindows([]);
        }
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
    return bind(ss, 'stageTexture').as((tex) =>
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
function SelectionArea({
    state,
    onResize,
}: {
    state: OverlayState;
    onResize: (height: number) => void;
}) {
    return (
        <Gtk.DrawingArea
            slot="overlay"
            focusable
            onResize={(_self, _width, height) => onResize(height)}
            onMap={(self) => {
                updateCanvasOrigin(state);
                self.grab_focus();
            }}
            ref={(self) => {
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
                // Controllers must be added imperatively — Gtk.Overlay cannot
                // mount Gtk.EventController as a buildable child.
                const drag = Gtk.GestureDrag.new();
                drag.connect('drag-begin', (_g, sx, sy) => {
                    if (state.ss.selectedTarget !== 'area' || state.reviewing()) return;
                    if (!updateCanvasOrigin(state)) {
                        drag.set_state(Gtk.EventSequenceState.DENIED);
                        return;
                    }
                    self.grab_focus();
                    onDragBegin(state, sx, sy);
                });
                drag.connect('drag-update', (_g, ox, oy) => onDragUpdate(state, ox, oy));
                drag.connect('drag-end', () => onDragEnd(state));
                self.add_controller(drag);

                const click = Gtk.GestureClick.new();
                click.set_button(1);
                click.connect('pressed', (_g, _n, cx, cy) => {
                    if (!updateCanvasOrigin(state)) return;
                    self.grab_focus();
                    onClickPressed(state, cx, cy);
                });
                self.add_controller(click);
                // Grouped controllers share state: do not deny a valid window
                // press merely because the drag callback is inactive in that mode.
                click.group(drag);

                // Right-click = cancel/dismiss, always available escape hatch.
                const cancel = Gtk.GestureClick.new();
                cancel.set_button(3);
                cancel.connect('pressed', () => {
                    state.ss.hideOverlay();
                });
                self.add_controller(cancel);
            }}
            hexpand
            vexpand
            css={'background: transparent;'}
        />
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
    const [selectedWindow, setSelectedWindow] = createState<WinInfo | null>(null);
    const [windows, setWindows] = createState<WinInfo[]>([]);
    const [monOrigin, setMonOrigin] = createState<Point>({x: 0, y: 0});
    const [reviewing, setReviewing] = createState(false);

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
        reviewing,
        setReviewing,
    };
    const target = bind(ss, 'selectedTarget');
    const focusedMonitor = bind(hyprland, 'focused-monitor');
    const targetSummary = computed(() => {
        const selectedTarget = target();
        if (selectedTarget === 'fullscreen') return 'Full desktop';
        const selection = getSelectionState(state);
        const monitor = focusedMonitor();
        const geometry = buildGeometry(selectedTarget, selection);
        if (!geometry) {
            if (selectedTarget === 'window') return 'No window selected';
            if (selectedTarget === 'area') return 'No area selected';
            return 'No monitor selected';
        }
        const rectangle = `${geometry.x},${geometry.y} · ${geometry.width}×${geometry.height}`;
        if (selectedTarget === 'window') {
            const window = selectedWindow();
            return `${window?.title || 'Untitled window'} (${window?.address}) · ${rectangle}`;
        }
        if (selectedTarget === 'monitor') return `Monitor ${monitor?.name ?? ''} · ${rectangle}`;
        return `Area · ${rectangle}`;
    });
    // Panel margins are 24px top/bottom; track the real overlay height so the
    // panel stays inside short monitors regardless of scale or reserved areas.
    const [overlayHeight, setOverlayHeight] = createState(600);
    const panelMaxHeight = overlayHeight.as((height) => Math.max(200, Math.min(600, height - 48)));
    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().setOverlay(self);
                // Capture keys before focused controls; Enter reviews but never
                // activates the capture confirmation as an implicit default.
                const key = Gtk.EventControllerKey.new();
                key.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
                key.connect('key-pressed', (_c, keyval) => handleKey(state, keyval));
                self.add_controller(key);
            }}
            name={LOG_TAG}
            application={getApp()}
            namespace={'shade-screenshot'}
            layer={Astal.Layer.TOP}
            // ON_DEMAND (like every other popup in this codebase): the surface
            // only grabs keyboard when focused. EXCLUSIVE grabbed ALL keys as
            // soon as the overlay mapped, which turned a handler failure into
            // a trapped desktop (every key swallowed, nothing interactive).
            keymode={Astal.Keymode.ON_DEMAND}
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={isVisible}
            onNotifyVisible={(self) => {
                if (self.visible) {
                    updateCanvasOrigin(state);
                    try {
                        setWindows(loadWindows(getHyprlandClientSnapshot()));
                    } catch (error) {
                        logger.error(LOG_TAG, `failed to refresh window geometry: ${error}`);
                        setWindows([]);
                    }
                }
                resetSelection(state);
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={bind(hyprland, 'focused-monitor').as(monitorIndexFromHyprland)}
            css={'background: transparent;'}
        >
            <Gtk.Overlay>
                {/* Main child: the frozen stage (must be first, no slot). */}
                <OverlayBackground ss={ss} />

                {/* Overlay layer: selection surface (needs explicit overlay slot or
                    it replaces the main child and the stage never renders). */}
                <SelectionArea
                    state={state}
                    onResize={(height) => {
                        if (height > 0 && height !== overlayHeight()) setOverlayHeight(height);
                    }}
                />

                <ControlPanel
                    quick={bind(ss, 'overlayQuick')}
                    ss={ss}
                    reviewing={reviewing}
                    targetSummary={targetSummary}
                    maxHeight={panelMaxHeight}
                    onBack={() => setReviewing(false)}
                    onReview={() => reviewCurrentSelection(state)}
                    onCapture={() => executeCapture(state)}
                    onCancel={() => ss.hideOverlay()}
                    onReset={() => resetSelection(state)}
                    onTargetChange={(value) => handleTargetChange(state, value)}
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};
