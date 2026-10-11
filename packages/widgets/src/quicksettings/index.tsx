import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import LayoutService from '@shade/services/display/layouts';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, onCleanup} from 'gnim';
import {ButtonGrid} from './button-grid/index';
import {DisplaySection} from './display';
import {Expander} from './expander/index';
import {NotificationList} from './notificationList';
import {AudioConfig, BrightnessSlider, MicConfig} from './sliders';
import {TrayBox} from './tray';

const QUICKSETTINGS_WIDTH = 420;
const QUICKSETTINGS_SPACING = 8;
const WINDOW_MARGIN = 12;
const BAR_EDGE_RESERVE = 48;

function availableWidth(
    monitor: {width: number; scale: number} | null,
    preferred: number,
    barPosition: number,
    left: number,
    right: number
) {
    const logicalWidth = monitor
        ? monitor.width / (monitor.scale || 1)
        : preferred + WINDOW_MARGIN * 2;
    const barReserve = barPosition === left || barPosition === right ? BAR_EDGE_RESERVE : 0;
    return Math.max(1, Math.min(preferred, logicalWidth - WINDOW_MARGIN * 2 - barReserve));
}

export default () => {
    const barCfg = barSettings();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const shellState = ShellState.get_default();
    const service = LayoutService.get_default();
    const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;
    const focusedMonitor = bind(hyprland, 'focused-monitor');
    const settingsWidth = computed(() =>
        availableWidth(focusedMonitor(), QUICKSETTINGS_WIDTH, barCfg.position(), LEFT, RIGHT)
    );

    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().setQuicksettings(self);
                self.connect('realize', () => logger.log('quicksettings realized'));
                self.connect('map', () => logger.log('quicksettings mapped'));

                let originalKeymode: Astal.Keymode | null = null;
                const restoreKeymode = () => {
                    if (originalKeymode === null) return;
                    self.keymode = originalKeymode;
                    originalKeymode = null;
                };
                const chooserSignal = service.connect('mode-chooser-requested', () => {
                    if (originalKeymode === null) originalKeymode = self.keymode;
                    self.keymode = Astal.Keymode.EXCLUSIVE;
                });
                const unmapSignal = self.connect('unmap', restoreKeymode);
                const keyController = Gtk.EventControllerKey.new();
                keyController.connect('key-pressed', (_controller, keyval) => {
                    if (keyval !== Gdk.KEY_Escape || !self.visible) return false;
                    void service
                        .revert()
                        .catch(() => undefined)
                        .finally(() => {
                            shellState.qsOpen = false;
                        });
                    return true;
                });
                self.add_controller(keyController);
                onCleanup(() => {
                    service.disconnect(chooserSignal);
                    self.disconnect(unmapSignal);
                    self.remove_controller(keyController);
                    restoreKeymode();
                });
            }}
            marginTop={WINDOW_MARGIN}
            marginBottom={WINDOW_MARGIN}
            marginStart={WINDOW_MARGIN}
            marginEnd={WINDOW_MARGIN}
            application={getApp()}
            name={'quicksettings'}
            visible={bind(shellState, 'qsOpen')}
            onNotifyVisible={(self) => {
                logger.log(`quicksettings visible -> ${self.visible}`);
                if (
                    (barCfg.position() === LEFT || barCfg.position() === RIGHT) &&
                    self.visible &&
                    ShellState.get_default().launcherOpen
                )
                    bus.emit('shell:launcher:close');
                shellState.qsOpen = self.visible;
            }}
            cssClasses={[]}
            css={'background-color: transparent;'}
            anchor={barCfg.position.as((p) => TOP | (p === LEFT ? LEFT : RIGHT) | BOTTOM)}
            widthRequest={settingsWidth}
            monitor={focusedMonitor.as((m) => monitorIndexFromHyprland(m))}
        >
            <Gtk.Box
                cssClasses={['card']}
                css={'box-shadow: none; background-color: @window_bg_color;'}
                orientation={Gtk.Orientation.VERTICAL}
            >
                <Gtk.ScrolledWindow
                    propagateNaturalHeight
                    maxContentWidth={settingsWidth}
                    propagateNaturalWidth={false}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                    vexpand
                >
                    <Gtk.Box
                        spacing={QUICKSETTINGS_SPACING}
                        marginTop={16}
                        marginBottom={16}
                        marginStart={16}
                        marginEnd={16}
                        orientation={Gtk.Orientation.VERTICAL}
                    >
                        <ButtonGrid />
                        <DisplaySection />
                        <BrightnessSlider />
                        <AudioConfig />
                        <MicConfig />
                        <TrayBox />
                        <Expander />
                        <NotificationList />
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </Astal.Window>
    );
};
