import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {bind} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickToggleButton} from '../../common/quickToggleButton';
import type {QuickButton} from './quickButton';

const SET_SCHEME = 'display:colorscheme:set';

export default (): QuickButton => {
    const colorScheme = ColorScheme.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button onClicked={() => bus.emit(SET_SCHEME, DarkModes.AUTO)}>
                    <Adw.ButtonContent iconName="night-light-symbolic" label="Automatic" />
                </Gtk.Button>
                <Gtk.Button onClicked={() => bus.emit(SET_SCHEME, DarkModes.LIGHT)}>
                    <Adw.ButtonContent iconName="weather-clear-symbolic" label="Light Mode" />
                </Gtk.Button>
                <Gtk.Button onClicked={() => bus.emit(SET_SCHEME, DarkModes.DARK)}>
                    <Adw.ButtonContent iconName="weather-clear-night-symbolic" label="Dark Mode" />
                </Gtk.Button>
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickToggleButton
                icon={bind(colorScheme, 'iconName')}
                label={bind(colorScheme, 'colorScheme').as((c) => {
                    if (c === DarkModes.AUTO) return 'Auto';
                    if (c === DarkModes.LIGHT) return 'Light Mode';
                    return 'Dark Mode';
                })}
                onClick={() => {
                    if (colorScheme.colorScheme === DarkModes.LIGHT) {
                        bus.emit(SET_SCHEME, DarkModes.DARK);
                    } else if (colorScheme.colorScheme === DarkModes.DARK) {
                        bus.emit(SET_SCHEME, DarkModes.LIGHT);
                    } else if (colorScheme.daytime) {
                        bus.emit(SET_SCHEME, DarkModes.DARK);
                    } else {
                        bus.emit(SET_SCHEME, DarkModes.LIGHT);
                    }
                }}
                popover={popover}
            />
        ),
    };
};
