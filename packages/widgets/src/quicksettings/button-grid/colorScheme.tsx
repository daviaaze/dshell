import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import type {QuickButton} from './quickButton';
import {QuickToggleButton} from '../../common/quickToggleButton';
import {LinkedBox} from '../../common/linkedBox';
import {bus} from '@shade/services/bus';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';

export default (): QuickButton => {
    const colorScheme = ColorScheme.get_default();

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button
                    onClicked={() => bus.emit('display:colorscheme:set', DarkModes.AUTO)}
                >
                    <Adw.ButtonContent
                        iconName="night-light-symbolic"
                        label="Automatic"
                    />
                </Gtk.Button>
                <Gtk.Button
                    onClicked={() =>
                        bus.emit('display:colorscheme:set', DarkModes.LIGHT)
                    }
                >
                    <Adw.ButtonContent
                        iconName="weather-clear-symbolic"
                        label="Light Mode"
                    />
                </Gtk.Button>
                <Gtk.Button
                    onClicked={() => bus.emit('display:colorscheme:set', DarkModes.DARK)}
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
                        bus.emit('display:colorscheme:set', DarkModes.DARK);
                    } else if (colorScheme.colorScheme === DarkModes.DARK) {
                        bus.emit('display:colorscheme:set', DarkModes.LIGHT);
                    } else if (colorScheme.daytime) {
                        bus.emit('display:colorscheme:set', DarkModes.DARK);
                    } else {
                        bus.emit('display:colorscheme:set', DarkModes.LIGHT);
                    }
                }}
                popover={popover}
            />
        ),
    };
};
