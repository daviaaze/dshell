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
import {createSettingsWindow} from './settings';
import {Wallpaper} from './wallpaper';
import Weather from '#/lib/weather';
import {ColorScheme} from '#/lib/colorScheme';
import Inhibit from '#/lib/inhibit';
import NightLight from '#/lib/nightLight';
import Hypridle from '#/lib/hypridle';
import Touchpad from '#/lib/touchpad';
import Theming from '#/lib/theming';
import {getNotifdSafe} from '#/lib/notifdGuard';
import NotificationHistory from '#/lib/notificationHistory';
import TimerService from './quicksettings/timer/TimerService';
import {initAutoSwitch} from '#/lib/audioAutoSwitch';
import {app} from '#/App';
import {useSettings} from '#/lib/settings';
import WindowManager from '#/lib/windowManager';
import logger, {perf} from '#/lib/logger';

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

// ── Service initialization descriptors ──

interface ServiceDescriptor {
    name: string;
    init: () => void;
}

function getServiceDescriptors(
    s: ReturnType<typeof useSettings>
): ServiceDescriptor[] {
    return [
        {
            name: 'Weather',
            init: () => Weather.get_default().init(s.weather),
        },
        {
            name: 'ColorScheme',
            init: () =>
                ColorScheme.get_default().init(
                    Weather.get_default(),
                    s.general
                ),
        },
        {
            name: 'Inhibit',
            init: () => Inhibit.get_default().init(app),
        },
        {
            name: 'NightLight',
            init: () =>
                NightLight.get_default().init(
                    s.general,
                    ColorScheme.get_default()
                ),
        },
        {
            name: 'Hypridle',
            init: () => Hypridle.get_default().init(s.general),
        },
        {
            name: 'Touchpad',
            init: () => {
                try {
                    Touchpad.get_default().init();
                } catch (e) {
                    logger.warn(
                        'mount',
                        'Touchpad init skipped (no touchpad?):',
                        e
                    );
                }
            },
        },
        {
            name: 'Theming',
            init: () => Theming.get_default().init(s.general),
        },
        {
            name: 'Notifd (pre-init)',
            init: () => getNotifdSafe(),
        },
        {
            name: 'NotificationHistory',
            init: () => NotificationHistory.get_default().init(s.general),
        },
        {
            name: 'AudioAutoSwitch',
            init: () => initAutoSwitch(),
        },
        {
            name: 'TimerService',
            init: () =>
                TimerService.get_default().init(
                    app,
                    s.timer.pomodoroWorkDuration(),
                    s.timer.pomodoroBreakDuration(),
                    s.timer.pomodoroLongBreakDuration(),
                    s.timer.pomodoroSessionsBeforeLongBreak()
                ),
        },
    ];
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
        {
            name: 'settings',
            mount: () => {
                const win = createSettingsWindow();
                wm.setSettings(win);
            },
        },
    ];
}

// ── Main widget bootstrap ──

export const widgets = () => {
    perf.start('services-init', 'mount');
    logger.log('widgets() starting...');
    const s = useSettings();

    // Initialize services in order
    for (const {name, init} of getServiceDescriptors(s)) {
        perf.start(`service-${name}`, 'mount');
        try {
            init();
            logger.info(
                'mount',
                `service ${name} init in ${perf.stop(`service-${name}`, 'mount').toFixed(1)}ms`
            );
        } catch (e) {
            logger.error('mount', `Service ${name} init FAILED:`, e);
        }
    }
    perf.stop('services-init', 'mount');

    // Mount widgets with error isolation
    for (const {name, mount} of getWidgetDescriptors()) {
        perf.start(`widget-${name}`, 'mount');
        try {
            mount();
            logger.info(
                'mount',
                `${name} mounted in ${perf.stop(`widget-${name}`, 'mount').toFixed(1)}ms`
            );
        } catch (e) {
            logger.error('mount', `Widget ${name} FAILED to mount:`, e);
        }
    }

    logger.log('widgets() done');
    perf.stop('widgets-mount', 'mount');
};
