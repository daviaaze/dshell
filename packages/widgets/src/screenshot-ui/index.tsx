import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {getHyprland} from '@shade/services/hyprland';
import {bind, createState} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
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
    loadWindows,
    getMonitorOrigin,
    type Point,
    type WinInfo,
    type SelectionState,
} from './selection';

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

    let daRef: Gtk.DrawingArea | null = null;

    function getSelectionState(): SelectionState {
        const mon = hyprland?.focusedMonitor;
        return {
            dragStart: dragStart(),
            dragEnd: dragEnd(),
            selActive: selActive(),
            selectedWindow: selectedWindow(),
            windows: windows(),
            monOrigin: monOrigin(),
            focusedMonitor: mon
                ? {x: mon.x, y: mon.y, width: mon.width, height: mon.height}
                : null,
        };
    }

    function resetSelection() {
        setDragStart(null);
        setDragEnd(null);
        setSelActive(false);
        setSelectedWindow(null);
    }

    function refreshWindows() {
        setWindows(loadWindows(hyprland!.get_clients()));
    }

    function refreshMonOrigin() {
        setMonOrigin(getMonitorOrigin(hyprland!.focusedMonitor));
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

    const onDragUpdate = (_g: Gtk.GestureDrag, ox: number, oy: number) => {
        if (!selActive()) return;
        const s = dragStart();
        if (s) {
            setDragEnd({x: s.x + ox, y: s.y + oy});
            daRef?.queue_draw();
        }
    };

    const onDragEnd = (_g: Gtk.GestureDrag, _ox: number, _oy: number) => {
        if (!selActive()) return;
        const s = normalizeRect(dragStart()!, dragEnd()!);
        if (s.width < 5 || s.height < 5) resetSelection();
        daRef?.queue_draw();
    };

    const onClickPressed = (
        _g: Gtk.GestureClick,
        _n: number,
        cx: number,
        cy: number
    ) => {
        if (ss.selectedTarget !== 'window') return;
        const origin = monOrigin();
        const winList = windows();
        for (let i = winList.length - 1; i >= 0; i--) {
            const w = winList[i]!;
            if (
                cx + origin.x >= w.x &&
                cx + origin.x <= w.x + w.width &&
                cy + origin.y >= w.y &&
                cy + origin.y <= w.y + w.height
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
            bus.emit('capture:cmd:region-selector:close');
            return true;
        }
        if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
            executeCapture();
            return true;
        }
        return false;
    };

    // ── Capture / Recording ───────────────────────────────────────

    function executeCapture() {
        const mode = ss.selectedMode;
        const target = ss.selectedTarget;
        const geometry = buildGeometry(target, getSelectionState());

        if (
            (target === 'area' && !selActive()) ||
            (target === 'window' && !selectedWindow())
        )
            return;

        logger.info(
            'screenshot-ui',
            `capture: mode=${mode}, target=${target}, geom=${geometry ?? 'full'}`
        );

        if (mode === 'screenshot') {
            bus.emit('capture:cmd:capture-from-stage', geometry);
        } else {
            bus.emit('capture:cmd:start-recording-after-overlay', {target, geometry});
        }
    }

    function handleTargetChange(_value: string) {
        if (_value === 'window') refreshWindows();
        daRef?.queue_draw();
    }

    // ── Render ────────────────────────────────────────────────────

    return (
        <Astal.Window
            ref={self => WindowManager.get_default().setOverlay(self)}
            name={'screenshot-ui'}
            application={getApp()}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.EXCLUSIVE}
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={isVisible}
            onNotifyVisible={self => {
                if (self.visible) {
                    refreshMonOrigin();
                    refreshWindows();
                    resetSelection();
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
            monitor={bind(hyprland, 'focused-monitor').as(
                monitorIndexFromHyprland
            )}
            css={'background-color: transparent;'}
        >
            <Gtk.Overlay>
                {/* Frozen background OR transparent box in recording mode */}
                {isScreenshotMode(ss.selectedMode) && ss.stageTexture ? (
                    <Gtk.Picture
                        paintable={ss.stageTexture}
                        hexpand
                        vexpand
                        canShrink={false}
                        contentFit={Gtk.ContentFit.FILL}
                    />
                ) : (
                    <Gtk.Box hexpand vexpand />
                )}

                {/* Selection DrawingArea overlay */}
                <Gtk.DrawingArea
                    ref={self => {
                        daRef = self;
                        self.set_draw_func((_da, cr, w, h) =>
                            draw(_da, cr, w, h, {
                                ss,
                                selActive: selActive(),
                                dragStart: dragStart(),
                                dragEnd: dragEnd(),
                                selectedWindow: selectedWindow(),
                                windows: windows(),
                                monOrigin: monOrigin(),
                            })
                        );
                        // Debug: verify the drawing area actually gets mapped
                        // and allocated inside the overlay window.
                        self.connect('map', (w) => {
                            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                const a = w.get_allocation();
                                const parent = w.get_parent();
                                const pa = parent?.get_allocation();
                                // log every sibling's allocation to find who
                                // gets space and who doesn't
                                let sib = parent?.get_first_child();
                                const sibs: string[] = [];
                                while (sib) {
                                    const sa = sib.get_allocation();
                                    sibs.push(
                                        `${sib.constructor.name}=${sa.width}x${sa.height}`
                                    );
                                    sib = sib.get_next_sibling();
                                }
                                logger.info(
                                    'screenshot-ui',
                                    `DA alloc=${a.width}x${a.height} parent=${parent ? parent.constructor.name : 'null'} palloc=${pa?.width}x${pa?.height} sibs=[${sibs.join(', ')}]`
                                );
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    }}
                    hexpand
                    vexpand
                    css={'background: transparent;'}
                >
                    <Gtk.GestureDrag
                        ref={self => {
                            self.connect('drag-begin', onDragBegin);
                            self.connect('drag-update', onDragUpdate);
                            self.connect('drag-end', onDragEnd);
                        }}
                    />
                    <Gtk.GestureClick
                        ref={self => {
                            self.set_button(1);
                            self.connect('pressed', onClickPressed);
                        }}
                    />
                </Gtk.DrawingArea>

                {/* Control panel */}
                <ControlPanel
                    ss={ss}
                    onCapture={executeCapture}
                    onReset={resetSelection}
                    onTargetChange={handleTargetChange}
                />

                {/* Keyboard handler */}
                <Gtk.EventControllerKey
                    ref={self => self.connect('key-pressed', handleKey)}
                />
            </Gtk.Overlay>
        </Astal.Window>
    );
};
