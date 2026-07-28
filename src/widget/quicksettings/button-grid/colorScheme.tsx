import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import type {QuickButton} from './quickButton';
import {QuickToggleButton} from '../../common/quickToggleButton';
import {LinkedBox} from '../../common/linkedBox';
import {ColorScheme, DarkModes} from '../../../lib/services/display/colorScheme';

export default (): QuickButton => {
    const colorScheme = ColorScheme.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button
                    onClicked={() => (colorScheme.colorScheme = DarkModes.AUTO)}
                >
                    <Adw.ButtonContent
                        iconName="night-light-symbolic"
                        label="Automatic"
                    />
                </Gtk.Button>
                <Gtk.Button
                    onClicked={() =>
                        (colorScheme.colorScheme = DarkModes.LIGHT)
                    }
                >
                    <Adw.ButtonContent
                        iconName="weather-clear-symbolic"
                        label="Light Mode"
                    />
                </Gtk.Button>
                <Gtk.Button
                    onClicked={() => (colorScheme.colorScheme = DarkModes.DARK)}
                >
                    <Adw.ButtonContent
                        iconName="weather-clear-night-symbolic"
                        label="Dark Mode"
                    />
                </Gtk.Button>
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                icon={bind(colorScheme, 'iconName')}
                label={bind(colorScheme, 'colorScheme').as(c => {
                    if (c === DarkModes.AUTO) return 'Auto';
                    if (c === DarkModes.LIGHT) return 'Light Mode';
                    return 'Dark Mode';
                })}
                onClick={() => {
                    if (colorScheme.colorScheme === DarkModes.LIGHT) {
                        colorScheme.colorScheme = DarkModes.DARK;
                    } else if (colorScheme.colorScheme === DarkModes.DARK) {
                        colorScheme.colorScheme = DarkModes.LIGHT;
                    } else if (colorScheme.daytime) {
                        colorScheme.colorScheme = DarkModes.DARK;
                    } else {
                        colorScheme.colorScheme = DarkModes.LIGHT;
                    }
                }}
                popover={popover}
            />
        ),
    };
};
