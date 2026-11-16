import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {getDesktopStageBounds} from '@shade/services/capture/geometry';
import Screenshot from '@shade/services/capture/screenshot';
import {getHyprland, getHyprlandClientSnapshot} from '@shade/services/hyprland';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, computed, createState} from 'gnim';
import {ControlPanel} from './controlPanel';
import {draw} from './drawing';
import {
    buildGeometry,
    clampStagePoint,
    getMonitorOrigin,
    isScreenshotMode,
    loadWindows,
    normalizeRect,
    type Point,
    type ResizeEdge,
    resizeEdgeAt,
    resizeRect,
    type SelectionState,
    type StageTransform,
    stageToView,
    stageTransform,
    viewToStage,
    type WinInfo,
    windowAt,
} from './selection';

const LOG_TAG = 'screenshot-ui';
const RESIZE_CURSORS: Record<ResizeEdge, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
};

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
    resizeEdge: Accessor<ResizeEdge | null>;
    setResizeEdge: (v: ResizeEdge | null) => void;
    resizeRect: Accessor<{x: number; y: number; width: number; height: number} | null>;
    setResizeRect: (v: {x: number; y: number; width: number; height: number} | null) => void;
    resizeStart: Accessor<Point | null>;
    setResizeStart: (value: Point | null) => void;
    transform: Accessor<StageTransform | null>;
    setTransform: (value: StageTransform | null) => void;
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
        focusedMonitor: mon ? {x: mon.x, y: mon.y, width: mon.width, height: mon.height} : null,
        transform: state.transform(),
    };
}

function resetSelection(state: OverlayState) {
    state.setDragStart(null);
    state.setDragEnd(null);
    state.setSelActive(false);
    state.setSelectedWindow(null);
    state.setResizeEdge(null);
    state.setResizeRect(null);
    state.setResizeStart(null);
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

function updateStageTransform(state: OverlayState, width: number, height: number) {
    const texture = state.ss.stageTexture;
    if (!texture || !isScreenshotMode(state.ss.selectedMode) || width <= 0 || height <= 0) {
        state.setTransform(null);
        return;
    }
    const bounds = getDesktopStageBounds();
    state.setTransform(
        stageTransform(
            bounds.width,
            bounds.height,
            width,
            height,
            bounds.x,
            bounds.y,
            texture.get_width(),
            texture.get_height()
        )
    );
}

function onDragBegin(state: OverlayState, sx: number, sy: number) {
    if (state.ss.selectedTarget !== 'area') return;
    const transform = state.transform();
    const start = transform ? clampStagePoint({x: sx, y: sy}, transform) : {x: sx, y: sy};
    const dragStart = state.dragStart();
    const dragEnd = state.dragEnd();
    const active =
        state.selActive() && dragStart && dragEnd
            ? resizeEdgeAt(normalizeRect(dragStart, dragEnd), start)
            : null;
    if (active && dragStart && dragEnd) {
        state.setResizeEdge(active);
        state.setResizeStart(start);
        state.setResizeRect(normalizeRect(dragStart, dragEnd));
    } else {
        state.setResizeEdge(null);
        state.setDragStart(start);
        state.setDragEnd(start);
        state.setSelActive(true);
        state.setSelectedWindow(null);
    }
    state.daRef.current?.queue_draw();
}

function onDragUpdate(state: OverlayState, ox: number, oy: number) {
    const transform = state.transform();
    const edge = state.resizeEdge();
    const original = state.resizeRect();
    const resizeStart = state.resizeStart();
    if (edge && original && resizeStart) {
        let point = {x: resizeStart.x + ox, y: resizeStart.y + oy};
        if (transform) point = clampStagePoint(point, transform);
        const rect = resizeRect(original, edge, {
            x: point.x - resizeStart.x,
            y: point.y - resizeStart.y,
        });
        state.setDragStart({x: rect.x, y: rect.y});
        state.setDragEnd({x: rect.x + rect.width, y: rect.y + rect.height});
    } else if (state.selActive()) {
        const start = state.dragStart();
        if (start) {
            let end = {x: start.x + ox, y: start.y + oy};
            if (transform) end = clampStagePoint(end, transform);
            state.setDragEnd(end);
        }
    }
    state.daRef.current?.queue_draw();
}

function onDragEnd(state: OverlayState) {
    state.setResizeEdge(null);
    state.setResizeRect(null);
    const start = state.dragStart();
    const end = state.dragEnd();
    if (state.selActive() && start && end) {
        const rect = normalizeRect(start, end);
        if (rect.width < 5 || rect.height < 5) resetSelection(state);
    }
    state.setResizeStart(null);
    state.daRef.current?.queue_draw();
}

/** Source clicks select targets; dragging an area never starts capture. */
function onClickPressed(state: OverlayState, cx: number, cy: number) {
    const transform = state.transform();
    const point = transform ? viewToStage({x: cx, y: cy}, transform) : {x: cx, y: cy};
    const origin = transform ? {x: 0, y: 0} : state.monOrigin();
    const hit = windowAt(state.windows(), point.x, point.y, origin);
    if (!hit) return;
    if (state.ss.selectedTarget === 'window') {
        state.setSelectedWindow(hit);
    } else if (state.ss.selectedTarget === 'area') {
        const a = transform
            ? stageToView({x: hit.x, y: hit.y}, transform)
            : {x: hit.x - origin.x, y: hit.y - origin.y};
        const b = transform
            ? stageToView({x: hit.x + hit.width, y: hit.y + hit.height}, transform)
            : {x: a.x + hit.width, y: a.y + hit.height};
        state.setDragStart(a);
        state.setDragEnd(b);
        state.setSelActive(true);
        state.setSelectedWindow(null);
    }
    state.daRef.current?.queue_draw();
}

function isSelectionValid(state: OverlayState): boolean {
    const target = state.ss.selectedTarget;
    return (
        target === 'fullscreen' ||
        buildGeometry(target, getSelectionState(state), state.transform()) !== null
    );
}

/** Capture the current valid selection directly, without a review stage. */
function executeCapture(state: OverlayState) {
    if (state.ss.captureBusy || !isSelectionValid(state)) return;
    const target = state.ss.selectedTarget;
    const geom = buildGeometry(target, getSelectionState(state), state.transform());
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
        executeCapture(state);
        return true;
    }
    return false;
}

function handleTargetChange(state: OverlayState, value: string) {
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
                canShrink
                contentFit={Gtk.ContentFit.CONTAIN}
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
    onResize: (width: number, height: number) => void;
}) {
    return (
        <Gtk.DrawingArea
            slot="overlay"
            focusable
            onResize={(self, width, height) => {
                onResize(width, height);
                updateStageTransform(state, width, height);
                self.queue_draw();
            }}
            onMap={(self) => {
                updateCanvasOrigin(state);
                updateStageTransform(state, self.get_width(), self.get_height());
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
                        stageTransform: state.transform(),
                    })
                );
                // Controllers must be added imperatively — Gtk.Overlay cannot
                // mount Gtk.EventController as a buildable child.
                const drag = Gtk.GestureDrag.new();
                let dragMoved = false;
                drag.connect('drag-begin', (_g, sx, sy) => {
                    if (state.ss.selectedTarget !== 'area') return;
                    if (!updateCanvasOrigin(state)) {
                        drag.set_state(Gtk.EventSequenceState.DENIED);
                        return;
                    }
                    dragMoved = false;
                    self.grab_focus();
                    onDragBegin(state, sx, sy);
                });
                drag.connect('drag-update', (_g, ox, oy) => {
                    if (Math.abs(ox) > 4 || Math.abs(oy) > 4) dragMoved = true;
                    onDragUpdate(state, ox, oy);
                });
                drag.connect('drag-end', () => onDragEnd(state));
                self.add_controller(drag);

                const click = Gtk.GestureClick.new();
                click.set_button(1);
                click.connect('pressed', (_g, _n, cx, cy) => {
                    if (!updateCanvasOrigin(state)) return;
                    self.grab_focus();
                    if (state.ss.selectedTarget === 'area') dragMoved = false;
                    else onClickPressed(state, cx, cy);
                });
                click.connect('released', (_g, _n, cx, cy) => {
                    if (
                        state.ss.selectedTarget !== 'area' ||
                        dragMoved ||
                        !updateCanvasOrigin(state)
                    )
                        return;
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
                const motion = Gtk.EventControllerMotion.new();
                motion.connect('motion', (_controller, x, y) => {
                    const start = state.dragStart();
                    const end = state.dragEnd();
                    if (
                        state.ss.selectedTarget !== 'area' ||
                        !state.selActive() ||
                        !start ||
                        !end
                    ) {
                        self.set_cursor_from_name(null);
                        return;
                    }
                    const edge = resizeEdgeAt(normalizeRect(start, end), {x, y});
                    self.set_cursor_from_name(edge ? RESIZE_CURSORS[edge] : null);
                });
                motion.connect('leave', () => self.set_cursor_from_name(null));
                self.add_controller(motion);
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
    const [resizeEdge, setResizeEdge] = createState<ResizeEdge | null>(null);
    const [resizeRect, setResizeRect] = createState<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>(null);
    const [resizeStart, setResizeStart] = createState<Point | null>(null);
    const [transform, setTransform] = createState<StageTransform | null>(null);
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
        resizeEdge,
        setResizeEdge,
        resizeRect,
        setResizeRect,
        resizeStart,
        setResizeStart,
        transform,
        setTransform,
        daRef: {current: null},
    };
    const target = bind(ss, 'selectedTarget');
    const focusedMonitor = bind(hyprland, 'focused-monitor');
    const targetSummary = computed(() => {
        const selectedTarget = target();
        if (selectedTarget === 'fullscreen') return 'Área de trabalho inteira';
        const selection = getSelectionState(state);
        const monitor = focusedMonitor();
        const geometry = buildGeometry(selectedTarget, selection, state.transform());
        if (!geometry) {
            if (selectedTarget === 'window') return 'Nenhuma janela selecionada';
            if (selectedTarget === 'area') return 'Nenhuma área selecionada';
            return 'Nenhum monitor selecionado';
        }
        const rectangle = `${geometry.x},${geometry.y} · ${geometry.width}×${geometry.height}`;
        if (selectedTarget === 'window') {
            const window = selectedWindow();
            return `${window?.title || 'Janela sem título'} (${window?.address}) · ${rectangle}`;
        }
        if (selectedTarget === 'monitor') {
            const name = monitor?.name?.replace(/^Monitor\s+/, '') ?? '';
            const origin =
                geometry.x === 0 && geometry.y === 0 ? '' : `${geometry.x},${geometry.y} · `;
            return `${name || 'Monitor'} · ${origin}${geometry.width}×${geometry.height}`;
        }
        return `Área · ${rectangle}`;
    });
    const canCapture = computed(() => !ss.captureBusy && isSelectionValid(state));
    // Panel margins are 24px top/bottom; track the real overlay height so the
    // panel stays inside short monitors regardless of scale or reserved areas.
    const [overlayHeight, setOverlayHeight] = createState(600);
    const panelMaxHeight = overlayHeight.as((height) => Math.max(200, Math.min(600, height - 48)));
    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().setOverlay(self);
                // Capture keys before focused controls so Enter triggers only a valid, non-busy selection.
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
                    const canvas = state.daRef.current;
                    if (canvas)
                        updateStageTransform(state, canvas.get_width(), canvas.get_height());
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
                    onResize={(width, height) => {
                        if (height > 0 && height !== overlayHeight()) setOverlayHeight(height);
                        updateStageTransform(state, width, height);
                    }}
                />

                <ControlPanel
                    quick={bind(ss, 'overlayQuick')}
                    ss={ss}
                    canCapture={canCapture}
                    targetSummary={targetSummary}
                    maxHeight={panelMaxHeight}
                    onCapture={() => executeCapture(state)}
                    onCancel={() => ss.hideOverlay()}
                    onReset={() => resetSelection(state)}
                    onTargetChange={(value) => handleTargetChange(state, value)}
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};
