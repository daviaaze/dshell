import applauncher from './applauncher/index';
import bar from './bar/index';
import dock from './dock/index';
import {LockScreen} from './lockscreen/index';
import notifications from './notifications/index';
import osd from './osd/index';
import quicksettings from './quicksettings/index';
import windowswitcher from './windowswitcher/index';
import screenshotUi from './screenshot-ui/index';
import regionSelector from './region-selector/index';
import recordingBar from './recording-bar/index';
import recordingBoundary from './recording-boundary/index';
import {toggleWindowSwitcher} from './windowswitcher/index';
import {openSettings} from './settings/settingsOpen';
import {Wallpaper} from './wallpaper/index';
import Weather from '@shade/services/location/weather';
import MediaController from '@shade/services/session/mediaController';
import {ColorScheme} from '@shade/services/display/colorScheme';
import Inhibit from '@shade/services/power/inhibit';
import NightLight from '@shade/services/display/nightLight';
import Hypridle from '@shade/services/power/hypridle';
import AudioController from '@shade/services/audio/audioController';
import Touchpad from '@shade/services/input/touchpad';
import PaletteGenerator from '@shade/style/palette';
import {getNotifdSafe} from '@shade/services/notifications/guard';
import NotificationHistory from '@shade/services/notifications/history';
import DndService from '@shade/services/notifications/dnd';
import SoundAlertService from '@shade/services/audio/soundAlerts';
import SystemUsage from '@shade/services/monitoring/systemUsage';
import TimerService from '@shade/services/time/timerService';
import {FrecencyManager} from '@shade/services/search/frecency';
import TrayService from '@shade/services/desktop/trayService';
import NetworkService from '@shade/services/network/networkService';
import BluetoothService from '@shade/services/bluetooth/bluetoothService';
import {initAutoSwitch} from '@shade/services/audio/autoSwitch';
import {initAppWatcher} from '@shade/services/state/apps';
import {initClipboardHistory} from '@shade/services/clipboard/history';
import {getApp} from '@shade/services/appHandle';
import ShellState from '@shade/services/state/shellState';
import {useSettings} from '@shade/services/settings/index';
import WindowManager from '@shade/services/state/windowManager';
import ServiceRegistry from '@shade/core/serviceRegistry';
import type {GnimNode} from 'gnim';
import logger, {perf} from '@shade/core/logger';

// openSettings moved to ./settings/settingsOpen.ts (breaks tray cycle)

// ── Register services with lifecycle manager ──

export function registerServices(s: ReturnType<typeof useSettings>) {
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
            initArgs: [getApp()],
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
                getApp(),
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
    mount: () => GnimNode;
}

export function getWidgetDescriptors(): WidgetDescriptor[] {
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
