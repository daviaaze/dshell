import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Bar from './bar';
import WindowManager from '#/lib/services/state/windowManager';
import Weather from './weather';
import General from './general';
import Clock from './clock';
import Network from './network';
import {app} from '#/App';

export const createSettingsWindow = (): Adw.Window => {
    return (
        <Adw.Window
            $={self => WindowManager.get_default().setSettings(self)}
            hideOnClose={false}
            application={app}
            name={'settings'}
            cssClasses={['background']}
            title={'Shade Settings'}
        >
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                <Adw.HeaderBar
                    titleWidget={
                        (
                            <Adw.WindowTitle
                                title={'Shade Settings'}
                                cssClasses={['title-2']}
                            />
                        ) as Gtk.Widget
                    }
                />
                <Adw.PreferencesPage>
                    <General />
                    <Bar />
                    <Clock />
                    <Network />
                    <Weather />
                </Adw.PreferencesPage>
            </Gtk.Box>
        </Adw.Window>
    ) as Adw.Window;
};
