import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {IconNames} from '@shade/core/iconNames';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {getHyprland} from '@shade/services/hyprland';
import {monitors as nativeMonitors} from '@shade/services/monitoring/monitors';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, createState, effect, onCleanup} from 'gnim';
import {BAR_EDGE_RESERVE} from '../bar/geometry';
import {notificationCenterContentHeight} from '../common/notificationModel';
import {OPAQUE_SURFACE_CSS, SURFACE_PADDING, SURFACE_SECTION_SPACING} from '../common/surface';
import {openSettings} from '../settings/settingsOpen';
import {isHistoryClearDialogOpen, NotificationDndControl, NotificationList} from './list';

const WIDTH = 544;
const MARGIN = 4;
const {TOP, LEFT, RIGHT} = Astal.WindowAnchor;

export default () => {
    const state = ShellState.get_default();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const monitor = bind(hyprland, 'focused-monitor');
    const position = barSettings().position;
    const open = bind(state, 'notificationsOpen');
    const nativeMonitor = computed(
        () => nativeMonitors()[monitorIndexFromHyprland(monitor())] ?? null
    );
    const [monitorSize, setMonitorSize] = createState<{width: number; height: number} | null>(null);
    const [reservations, setReservations] = createState({reservedTop: 0, reservedBottom: 0});
    const [measured, setMeasured] = createState(false);
    const [chrome, setChrome] = createState({
        headerHeight: 0,
        surfaceInsets: SURFACE_PADDING * 2 + SURFACE_SECTION_SPACING,
    });
    let headerWidget: Gtk.Box | undefined;
    let windowWidget: Astal.Window | undefined;
    let refreshSequence = 0;
    let measureSource = 0;
    let alive = true;
    const width = computed(() => {
        const logical = monitorSize()?.width ?? WIDTH + MARGIN * 2;
        const reserve = position() === LEFT || position() === RIGHT ? BAR_EDGE_RESERVE : 0;
        return Math.max(1, Math.min(WIDTH, logical - MARGIN * 2 - reserve));
    });
    const scheduleMeasure = () => {
        if (!alive || measureSource) return;
        measureSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            measureSource = 0;
            if (!alive || !windowWidget || !headerWidget?.get_root()) return GLib.SOURCE_REMOVE;
            const style = windowWidget.get_style_context();
            const padding = style.get_padding();
            const border = style.get_border();
            const innerWidth = Math.max(
                1,
                Math.floor(
                    width() - SURFACE_PADDING * 2 -
                    padding.left - padding.right - border.left - border.right
                )
            );
            const headerHeight = headerWidget.measure(Gtk.Orientation.VERTICAL, innerWidth)[1];
            if (headerHeight <= 0) return GLib.SOURCE_REMOVE;
            setChrome({
                headerHeight,
                surfaceInsets: SURFACE_PADDING * 2 + SURFACE_SECTION_SPACING +
                    padding.top + padding.bottom + border.top + border.bottom,
            });
            // Do not map a first frame using the unrooted, zero-height header.
            setMeasured(true);
            // GTK retains the last window allocation; let the new cap shrink it.
            windowWidget.set_default_size(-1, -1);
            return GLib.SOURCE_REMOVE;
        });
    };
    const refreshReservations = () => {
        const sequence = ++refreshSequence;
        hyprland.sync_monitors((_source, result) => {
            try {
                hyprland.sync_monitors_finish(result);
                if (!alive || sequence !== refreshSequence) return;
                const connector = nativeMonitor()?.get_connector();
                const current = hyprland.get_monitors().find((item) => item.name === connector);
                if (!current) return;
                // Pinned Astal maps IPC reserved[1]/[3] to these logical-pixel fields.
                setReservations({
                    reservedTop: current.reservedBottom,
                    reservedBottom: current.reservedRight,
                });
            } catch (error) {
                if (alive) logger.warn('notification-center', 'monitor refresh failed:', error);
            }
            if (alive) scheduleMeasure();
        });
    };
    effect(() => {
        const current = nativeMonitor();
        if (!current) return;
        const updateGeometry = () => {
            // GDK receives live wl_output mode changes; Astal's cached monitor may not.
            // This rectangle is already logical pixels, including scale and rotation.
            const geometry = current.get_geometry();
            setMonitorSize({width: geometry.width, height: geometry.height});
            scheduleMeasure();
            refreshReservations();
        };
        updateGeometry();
        const signals = (['notify::geometry', 'notify::scale-factor'] as const)
            .map((signal) => current.connect(signal, updateGeometry));
        onCleanup(() => {
            for (const signal of signals) current.disconnect(signal);
        });
    });
    const hyprlandSignals = [
        hyprland.connect('config-reloaded', refreshReservations),
        hyprland.connect('monitor-added', refreshReservations),
        hyprland.connect('monitor-removed', refreshReservations),
    ];
    onCleanup(() => {
        for (const signal of hyprlandSignals) hyprland.disconnect(signal);
    });
    effect(() => {
        width();
        position();
        const isOpen = open();
        scheduleMeasure();
        if (isOpen) refreshReservations();
    });
    const header = (
        <Gtk.Box
            spacing={8}
            ref={(self) => {
                headerWidget = self;
                scheduleMeasure();
            }}
        >
            <Gtk.Label
                label="Notificações"
                cssClasses={['heading']}
                wrap
                wrapMode={Pango.WrapMode.WORD_CHAR}
                widthChars={1}
                hexpand
                xalign={0}
            />
            <NotificationDndControl />
            <Gtk.Button
                iconName={IconNames.preferencesSystem}
                cssClasses={['flat', 'circular']}
                tooltipText="Configurações de notificações"
                onClicked={() => openSettings('notifications')}
                ref={(self) =>
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [new GObject.Value(GObject.TYPE_STRING, 'Configurações de notificações')]
                    )
                }
            />
            <Gtk.Button
                iconName={IconNames.windowClose}
                cssClasses={['flat', 'circular']}
                tooltipText="Fechar notificações"
                onClicked={() => state.closeNotifications()}
                ref={(self) =>
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [new GObject.Value(GObject.TYPE_STRING, 'Fechar notificações')]
                    )
                }
            />
        </Gtk.Box>
    );
    const maxHeight = computed(() => notificationCenterContentHeight({
        monitorHeight: monitorSize()?.height ?? 720,
        ...reservations(),
        ...chrome(),
    }));
    return (
        <Astal.Window
            name="notification-center"
            title="Notificações"
            namespace="shade-notification-center"
            application={getApp()}
            visible={computed(() => open() && measured())}
            keymode={Astal.Keymode.ON_DEMAND}
            anchor={position.as((p) => TOP | (p === LEFT ? LEFT : RIGHT))}
            margin={MARGIN}
            widthRequest={width}
            monitor={monitor.as((m) => monitorIndexFromHyprland(m))}
            cssClasses={['background']}
            css={OPAQUE_SURFACE_CSS}
            onMap={scheduleMeasure}
            onNotifyVisible={(self) => {
                if (measured()) state.notificationsOpen = self.visible;
            }}
            ref={(self) => {
                windowWidget = self;
                scheduleMeasure();
                WindowManager.get_default().setNotificationCenter(self);
                const keys = Gtk.EventControllerKey.new();
                keys.connect('key-pressed', (_controller, keyval) => {
                    if (keyval !== Gdk.KEY_Escape || !self.visible) return false;
                    state.closeNotifications();
                    return true;
                });
                self.add_controller(keys);
                self.connect('unmap', () => state.closeNotifications());
                self.connect('notify::is-active', () => {
                    const modalChildOpen =
                        isHistoryClearDialogOpen(self) ||
                        getApp()
                            .get_windows()
                            .some(
                                (window) =>
                                    window !== self &&
                                    window.get_transient_for() === self &&
                                    window.modal
                            );
                    if (self.visible && !self.isActive && !modalChildOpen) {
                        state.closeNotifications();
                    }
                });
                onCleanup(() => {
                    alive = false;
                    if (measureSource) GLib.source_remove(measureSource);
                    self.remove_controller(keys);
                    const manager = WindowManager.get_default();
                    if (manager.notificationCenter === self) manager.setNotificationCenter(null);
                });
            }}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={SURFACE_SECTION_SPACING}
                marginTop={SURFACE_PADDING}
                marginBottom={SURFACE_PADDING}
                marginStart={SURFACE_PADDING}
                marginEnd={SURFACE_PADDING}
            >
                {header}
                <Gtk.ScrolledWindow
                    propagateNaturalHeight
                    minContentHeight={0}
                    maxContentWidth={width.as((value) => Math.max(1, value - SURFACE_PADDING * 2))}
                    maxContentHeight={maxHeight}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                >
                    <NotificationList />
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </Astal.Window>
    );
};
