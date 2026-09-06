import Adw from 'gi://Adw?version=1';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '@shade/services/state/windowManager';
import Appearance from './appearance';
import Bar from './bar';
import Clock from './clock';
import Debug from './debug';
import Displays from './displays';
import Idle from './idle';
import Network from './network';
import Notifications from './notifications';
import ScreenCapture from './screenCapture';
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

            <Adw.PreferencesPage title={'Displays'} iconName={'video-display-symbolic'}>
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
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Notifications'}
                iconName={'preferences-system-notifications-symbolic'}
            >
                <Notifications />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Screen Capture'} iconName={'camera-photo-symbolic'}>
                <ScreenCapture />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage title={'Network'} iconName={'network-wireless-symbolic'}>
                <Network />
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

            <Adw.PreferencesPage title={'Debug'} iconName={'applications-engineering-symbolic'}>
                <Debug />
            </Adw.PreferencesPage>
        </Adw.PreferencesWindow>
    ) as unknown as Adw.PreferencesWindow;
};