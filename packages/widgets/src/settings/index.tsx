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
            modal={false}
            application={getApp()}
            name={'settings'}
            cssClasses={['background']}
            title={'Shade Settings'}
            searchEnabled={true}
        >
            <Adw.PreferencesPage
                title={'Personalization'}
                iconName={'preferences-desktop-wallpaper-symbolic'}
            >
                <Appearance />
                <Bar />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Devices'}
                iconName={'preferences-desktop-display-symbolic'}
            >
                <Displays />
                <Sound />
                <Mouse />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Connectivity'}
                iconName={'network-wireless-symbolic'}
            >
                <Network />
                <Bluetooth />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Privacy & Security'}
                iconName={'system-lock-screen-symbolic'}
            >
                <Idle />
                <Power />
                <Notifications />
                <ScheduledDND />
                <ScreenCapture />
                <ScreenShare />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'Applications'}
                iconName={'preferences-desktop-apps-symbolic'}
            >
                <DefaultApps />
                <StartupApps />
            </Adw.PreferencesPage>

            <Adw.PreferencesPage
                title={'System'}
                iconName={'applications-engineering-symbolic'}
            >
                <Clock />
                <Weather />
                <Timer />
                <Shortcuts />
                <About />
                <Debug />
            </Adw.PreferencesPage>
        </Adw.PreferencesWindow>
    ) as unknown as Adw.PreferencesWindow;
};
