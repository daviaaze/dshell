import Adw from 'gi://Adw?version=1';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '@shade/services/state/windowManager';
import About from './about';
import Appearance from './appearance';
import Bar from './bar';
import Bluetooth from './bluetooth';
import Clock from './clock';
import Debug from './debug';
import DefaultApps from './defaultApps';
import Displays from './displays';
import Idle from './idle';
import Mouse from './mouse';
import Network from './network';
import Notifications from './notifications';
import Power from './power';
import ScheduledDND from './scheduledDND';
import ScreenCapture from './screenCapture';
import ScreenShare from './screenShare';
import Shortcuts from './shortcuts';
import Sound from './sound';
import StartupApps from './startupApps';
import Timer from './timer';
import Weather from './weather';

export const createSettingsWindow = (): Adw.PreferencesWindow => {
    return (
        <Adw.PreferencesWindow
            ref={(self) => WindowManager.get_default().setSettings(self)}
            hideOnClose={false}
            application={getApp()}
            name={'settings'}
            cssClasses={['background']}
            title={'Shade Settings'}
            searchEnabled={false}
        >
            <Adw.PreferencesPage
                title={'Appearance'}
                iconName={'preferences-desktop-wallpaper-symbolic'}
            >
                <Appearance />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Displays'}
                iconName={'preferences-desktop-display-symbolic'}
            >
                <Displays />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Bar & Dock'}
                iconName={'preferences-desktop-display-symbolic'}
            >
                <Bar />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Idle & Lock'} iconName={'system-lock-screen-symbolic'}>
                <Idle />
                <Power />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Notifications'}
                iconName={'preferences-system-notifications-symbolic'}
            >
                <Notifications />
                <ScheduledDND />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Screen Capture'} iconName={'camera-photo-symbolic'}>
                <ScreenCapture />
                <ScreenShare />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Network'} iconName={'network-wireless-symbolic'}>
                <Network />
                <Bluetooth />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Clock & Weather'}
                iconName={'preferences-system-time-symbolic'}
            >
                <Clock />
                <Weather />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Timer'} iconName={'alarm-symbolic'}>
                <Timer />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Sound'} iconName={'audio-volume-high-symbolic'}>
                <Sound />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Mouse & Touchpad'} iconName={'input-mouse-symbolic'}>
                <Mouse />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Keyboard Shortcuts'} iconName={'preferences-desktop-keyboard-shortcuts-symbolic'}>
                <Shortcuts />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Default Apps'} iconName={'preferences-desktop-apps-symbolic'}>
                <DefaultApps />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Startup Apps'} iconName={'system-run-symbolic'}>
                <StartupApps />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'About'} iconName={'help-about-symbolic'}>
                <About />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Debug'} iconName={'applications-engineering-symbolic'}>
                <Debug />
            </Adw.PreferencesPage>
        </Adw.PreferencesWindow>
    ) as unknown as Adw.PreferencesWindow;
};
