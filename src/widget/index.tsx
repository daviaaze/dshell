import applauncher from './applauncher';
import bar from './bar';
import dock from './dock';
import {LockScreen} from './lockscreen';
import notifications from './notifications';
import osd from './osd';
import quicksettings from './quicksettings';
import windowswitcher from './windowswitcher';
import screenshotUi from './screenshot-ui';
import regionSelector from './region-selector';
import recordingBar from './recording-bar';
import recordingBoundary from './recording-boundary';
import {toggleWindowSwitcher} from './windowswitcher';
import {createSettingsWindow} from './settings';
import {Wallpaper} from './wallpaper';
import Weather from '#/lib/services/location/weather';
import MediaController from '#/lib/services/session/mediaController';
import {ColorScheme} from '#/lib/services/display/colorScheme';
import Inhibit from '#/lib/services/power/inhibit';
import NightLight from '#/lib/services/display/nightLight';
import Hypridle from '#/lib/services/power/hypridle';
import AudioController from '#/lib/services/audio/audioController';
import Touchpad from '#/lib/services/input/touchpad';
import PaletteGenerator from '#/style/palette';
import {getNotifdSafe} from '#/lib/services/notifications/guard';
import NotificationHistory from '#/lib/services/notifications/history';
import DndService from '#/lib/services/notifications/dnd';
import SoundAlertService from '#/lib/services/audio/soundAlerts';
import SystemUsage from '#/lib/services/monitoring/systemUsage';
import TimerService from '#/lib/services/time/timerService';
import {FrecencyManager} from '#/lib/services/search/frecency';
import TrayService from '#/lib/services/desktop/trayService';
import NetworkService from '#/lib/services/network/networkService';
import BluetoothService from '#/lib/services/bluetooth/bluetoothService';
import {initAutoSwitch} from '#/lib/services/audio/autoSwitch';
import {initAppWatcher} from '#/lib/services/state/apps';
import {initClipboardHistory} from '#/lib/services/clipboard/history';
import {app} from '#/apps/shell/App';
import ShellState from '#/lib/services/state/shellState';
import {useSettings} from '#/lib/settings';
import WindowManager from '#/lib/services/state/windowManager';
import ServiceRegistry from '#/lib/core/serviceRegistry';
import logger, {perf} from '#/lib/core/logger';

// ── Settings window lifecycle ──

export const openSettings = () => {
    const wm = WindowManager.get_default();
    const existing = wm.settings;
    if (existing && existing.visible) {
        existing.present();
        return;
    }
    if (existing) {
        existing.destroy();
        wm.setSettings(null);
    }
    const win = createSettingsWindow();
    wm.setSettings(win);
    win.present();
};


// ── Register services with lifecycle manager ──

function registerServices(s: ReturnType<typeof useSettings>) {
    const reg = ServiceRegistry.get_default();
    reg.register(
        {
            name: 'AudioController',
            service: AudioController.get_default(),
        },
        {
            name: 'MediaController',
            service: MediaController.get_default(),
        },
        {
            name: 'Weather',
            service: Weather.get_default(),
            initArgs: [s.weather],
        },
        {
            name: 'ColorScheme',
            service: ColorScheme.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'Inhibit',
            service: Inhibit.get_default(),
            initArgs: [app],
        },
        {
            name: 'NightLight',
            service: NightLight.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'Hypridle',
            service: Hypridle.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'ShellState',
            service: ShellState.get_default(),
        },
        {
            name: 'WindowManager',
            service: WindowManager.get_default(),
        },
        {
            name: 'NetworkService',
            service: NetworkService.get_default(),
        },
        {
            name: 'BluetoothService',
            service: BluetoothService.get_default(),
        },
        {
            name: 'SystemUsage',
            service: SystemUsage.get_default(),
            initArgs: [s.bar.tempPath()],
        },
        {
            name: 'Touchpad',
            service: Touchpad.get_default(),
            critical: false,
        },
        {
            name: 'PaletteGenerator',
            service: PaletteGenerator.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'Notifd (pre-init)',
            service: {init: () => getNotifdSafe()},
        },
        {
            name: 'DndService',
            service: DndService.get_default(),
        },
        {
            name: 'TrayService',
            service: TrayService.get_default(),
        },
        {
            name: 'SoundAlerts',
            service: SoundAlertService.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'NotificationHistory',
            service: NotificationHistory.get_default(),
            initArgs: [s.general],
        },
        {
            name: 'AudioAutoSwitch',
            service: {init: () => initAutoSwitch()},
        },
        {
            name: 'TimerService',
            service: TimerService.get_default(),
            initArgs: [
                app,
                s.timer.pomodoroWorkDuration(),
                s.timer.pomodoroBreakDuration(),
                s.timer.pomodoroLongBreakDuration(),
                s.timer.pomodoroSessionsBeforeLongBreak(),
            ],
        },
        {
            name: 'AppWatcher',
            service: {init: () => initAppWatcher()},
        },
        {
            name: 'ClipboardHistory',
            service: {init: () => initClipboardHistory()},
        },
        {
            name: 'FrecencyManager',
            service: FrecencyManager.get_default(),
        }
    );
}

// ── Widget mount descriptors ──

interface WidgetDescriptor {
    name: string;
    mount: () => void;
}

function getWidgetDescriptors(): WidgetDescriptor[] {
    const wm = WindowManager.get_default();
    return [
        {name: 'wallpaper', mount: Wallpaper},
        {name: 'bar', mount: bar},
        {name: 'dock', mount: dock},
        {name: 'osd', mount: osd},
        {name: 'applauncher', mount: applauncher},
        {name: 'quicksettings', mount: quicksettings},
        {name: 'lockscreen', mount: LockScreen},
        {name: 'windowswitcher', mount: windowswitcher},
        {name: 'screenshot-ui', mount: screenshotUi},
        {name: 'region-selector', mount: regionSelector},
        {name: 'recording-bar', mount: recordingBar},
        {name: 'recording-boundary', mount: recordingBoundary},
        {name: 'notifications', mount: notifications},
        {name: 'settings', mount: () => {}}, // created lazily by openSettings()
    ];
}

// ── Wire ShellState callbacks (invert reverse dependency) ──

ShellState.get_default().registerWidgetActions({
    onToggleSettings: () => openSettings(),
    onToggleWindowSwitcher: () => toggleWindowSwitcher(),
});

// ── Main widget bootstrap ──

export const widgets = () => {
    perf.start('services-init', 'mount');
    logger.log('widgets() starting...');
    const s = useSettings();

    // Register and initialize services via lifecycle manager
    registerServices(s);
    const ok = ServiceRegistry.get_default().initAll();
    if (!ok) {
        logger.error('mount', 'Some services failed to init — continuing');
    }
    perf.stop('services-init', 'mount');

    // Mount widgets with error isolation
    for (const {name, mount} of getWidgetDescriptors()) {
        perf.start(`widget-${name}`, 'mount');
        try {
            mount();
            const wgtKey = `widget-${name}`;
            logger.info(
                'mount',
                `${name} mounted in ${perf.stop(wgtKey, 'mount').toFixed(1)}ms`
            );
        } catch (e) {
            logger.error('mount', `Widget ${name} FAILED to mount:`, e);
        }
    }

    logger.log('widgets() done');
    perf.stop('widgets-mount', 'mount');
};
