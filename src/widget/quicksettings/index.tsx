import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import WindowManager from '#/lib/services/state/windowManager';
import {useSettings} from '#/lib/settings';
import PopupWindow from '#/widget/common/PopupWindow';
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

    return (
        <PopupWindow
            name="quicksettings"
            visible={createBinding(ShellState.get_default(), 'qsOpen')}
            onVisibleChange={visible => {
                logger.log(`quicksettings visible -> ${visible}`);
                if (
                    (barCfg.position() === Astal.WindowAnchor.LEFT || barCfg.position() === Astal.WindowAnchor.RIGHT) &&
                    visible &&
                    ShellState.get_default().launcherOpen
                )
                    ShellState.get_default().launcherOpen = false;
                ShellState.get_default().qsOpen = visible;
            }}
            widthRequest={QUICKSETTINGS_WIDTH}
            $={self => {
                WindowManager.get_default().setQuicksettings(self);
                self.connect('realize', () =>
                    logger.log('quicksettings realized')
                );
                self.connect('map', () => logger.log('quicksettings mapped'));
            }}
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
        </PopupWindow>
    );
};