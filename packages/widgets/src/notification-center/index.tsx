import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, onCleanup} from 'gnim';
import {BAR_EDGE_RESERVE} from '../bar/geometry';
import {openSettings} from '../settings/settingsOpen';
import {isHistoryClearDialogOpen, NotificationList} from './list';

const WIDTH = 544;
const MARGIN = 4;
const {TOP, LEFT, RIGHT} = Astal.WindowAnchor;

export default () => {
    const state = ShellState.get_default();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const monitor = bind(hyprland, 'focused-monitor');
    const position = barSettings().position;
    const width = computed(() => {
        const m = monitor();
        const logical = m ? m.width / (m.scale || 1) : WIDTH + MARGIN * 2;
        const reserve = position() === LEFT || position() === RIGHT ? BAR_EDGE_RESERVE : 0;
        return Math.max(1, Math.min(WIDTH, logical - MARGIN * 2 - reserve));
    });
    const header = new Adw.HeaderBar({
        titleWidget: new Adw.WindowTitle({title: 'Notificações'}),
        showStartTitleButtons: false,
        showEndTitleButtons: false,
    });
    const settingsButton = new Gtk.Button({
        iconName: 'preferences-system-symbolic',
        tooltipText: 'Notification settings',
    });
    settingsButton.connect('clicked', () => openSettings('notifications'));
    const closeButton = new Gtk.Button({
        iconName: 'window-close-symbolic',
        tooltipText: 'Close notifications',
    });
    closeButton.connect('clicked', () => state.closeNotifications());
    header.pack_end(settingsButton);
    header.pack_end(closeButton);
    const headerHeight = header.measure(Gtk.Orientation.VERTICAL, -1)[1];
    const maxHeight = computed(() => {
        const current = monitor();
        const logical = current ? current.height / (current.scale || 1) : 720;
        const reserve = position() === LEFT || position() === RIGHT ? 0 : BAR_EDGE_RESERVE;
        return Math.max(1, logical - MARGIN * 2 - headerHeight - reserve);
    });
    return (
        <Astal.Window
            name="notification-center"
            title="Notificações"
            namespace="shade-notification-center"
            application={getApp()}
            visible={bind(state, 'notificationsOpen')}
            keymode={Astal.Keymode.ON_DEMAND}
            anchor={position.as((p) => TOP | (p === LEFT ? LEFT : RIGHT))}
            margin={MARGIN}
            widthRequest={width}
            monitor={monitor.as((m) => monitorIndexFromHyprland(m))}
            cssClasses={[]}
            css="background-color: transparent;"
            onNotifyVisible={(self) => {
                state.notificationsOpen = self.visible;
            }}
            ref={(self) => {
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
                    self.remove_controller(keys);
                    const manager = WindowManager.get_default();
                    if (manager.notificationCenter === self) manager.setNotificationCenter(null);
                });
            }}
        >
            <Gtk.Box cssClasses={['card']} orientation={Gtk.Orientation.VERTICAL}>
                {header}
                <Gtk.ScrolledWindow
                    propagateNaturalHeight
                    minContentHeight={0}
                    maxContentWidth={width}
                    maxContentHeight={maxHeight}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                >
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={8}
                        marginTop={12}
                        marginBottom={12}
                        marginStart={12}
                        marginEnd={12}
                    >
                        <NotificationList />
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </Astal.Window>
    );
};
