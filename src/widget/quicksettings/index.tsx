import Hyprland from 'gi://AstalHyprland';
import {getHyprland} from '#/lib/hyprland';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import {app} from '#/apps/shell/App';
import WindowManager from '#/lib/services/state/windowManager';
import {useSettings} from '#/lib/settings';
import logger from '#/lib/core/logger';
import {NotificationList} from './notificationList';
import {TrayBox} from './tray';
import {AudioConfig, BrightnessSlider, MicConfig} from './sliders';
import {ButtonGrid} from './button-grid';
import {Expander} from './expander';
import ShellState from '#/lib/services/state/shellState';

const QUICKSETTINGS_WIDTH = 420;
const QUICKSETTINGS_SPACING = 8;

export default () => {
    const barCfg = useSettings().bar;
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const shellState = ShellState.get_default();
    const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

    return (
        <Astal.Window
            ref={self => {
                WindowManager.get_default().setQuicksettings(self);
                self.connect('realize', () =>
                    logger.log('quicksettings realized')
                );
                self.connect('map', () => logger.log('quicksettings mapped'));
            }}
            margin={12}
            application={app}
            name={'quicksettings'}
            visible={bind(shellState, 'qsOpen')}
            onNotifyVisible={self => {
                logger.log(`quicksettings visible -> ${self.visible}`);
                if (
                    (barCfg.position() === LEFT ||
                        barCfg.position() === RIGHT) &&
                    self.visible &&
                    ShellState.get_default().launcherOpen
                )
                    shellState.closeLauncher();
                shellState.qsOpen = self.visible;
            }}
            cssClasses={['card', 'frame', 'background']}
            anchor={barCfg.position.as(
                p => TOP | (p === LEFT ? LEFT : RIGHT) | BOTTOM
            )}
            widthRequest={QUICKSETTINGS_WIDTH}
            monitor={bind(hyprland, 'focused-monitor').as(m => m.id)}
        >
            <Gtk.ScrolledWindow
                propagateNaturalHeight
                hscrollbarPolicy={Gtk.PolicyType.NEVER}
                vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                vexpand
            >
                <Gtk.Box
                    spacing={QUICKSETTINGS_SPACING}
                    cssClasses={['popover-padded-lg']}
                    orientation={Gtk.Orientation.VERTICAL}
                >
                    <ButtonGrid />
                    <BrightnessSlider />
                    <AudioConfig />
                    <MicConfig />
                    <TrayBox />
                    <Expander />
                    <NotificationList />
                </Gtk.Box>
            </Gtk.ScrolledWindow>
        </Astal.Window>
    );
};
