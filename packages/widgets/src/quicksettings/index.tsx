import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {bind} from 'gnim';
import {ButtonGrid} from './button-grid/index';
import {Expander} from './expander/index';
import {NotificationList} from './notificationList';
import {AudioConfig, BrightnessSlider, MicConfig} from './sliders';
import {TrayBox} from './tray';

const QUICKSETTINGS_WIDTH = 420;
const QUICKSETTINGS_SPACING = 8;

export default () => {
    const barCfg = barSettings();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const shellState = ShellState.get_default();
    const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().setQuicksettings(self);
                self.connect('realize', () => logger.log('quicksettings realized'));
                self.connect('map', () => logger.log('quicksettings mapped'));
            }}
            marginTop={12}
            marginBottom={12}
            marginStart={12}
            marginEnd={12}
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
            cssClasses={['background']}
            anchor={barCfg.position.as((p) => TOP | (p === LEFT ? LEFT : RIGHT) | BOTTOM)}
            widthRequest={QUICKSETTINGS_WIDTH}
            monitor={bind(hyprland, 'focused-monitor').as((m) => m.id)}
        >
            <Gtk.ScrolledWindow
                propagateNaturalHeight
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
