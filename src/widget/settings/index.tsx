import Adw from 'gi://Adw?version=1';
import Bar from './bar';
import WindowManager from '../../lib/services/state/windowManager';
import Weather from './weather';
import Appearance from './appearance';
import Idle from './idle';
import Notifications from './notifications';
import Clock from './clock';
import Network from './network';
import ScreenCapture from './screenCapture';
import Timer from './timer';
import Debug from './debug';
import {getApp} from '../../lib/services/appHandle';

export const createSettingsWindow = (): Adw.PreferencesWindow => {
    return (
        <Adw.PreferencesWindow
            ref={self => WindowManager.get_default().setSettings(self)}
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
                title={'Bar & Dock'}
                iconName={'preferences-desktop-display-symbolic'}
            >
                <Bar />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Idle & Lock'}
                iconName={'system-lock-screen-symbolic'}
            >
                <Idle />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Notifications'}
                iconName={'preferences-system-notifications-symbolic'}
            >
                <Notifications />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Screen Capture'}
                iconName={'camera-photo-symbolic'}
            >
                <ScreenCapture />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Network'}
                iconName={'network-wireless-symbolic'}
            >
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

            <Adw.PreferencesPage
                title={'Debug'}
                iconName={'applications-engineering-symbolic'}
            >
                <Debug />
            </Adw.PreferencesPage>
        </Adw.PreferencesWindow>
    ) as unknown as Adw.PreferencesWindow;
};
