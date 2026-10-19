import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {bind, effect} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

const SET_SCHEME = 'display:colorscheme:set';

export default (): QuickButton => {
    const colorScheme = ColorScheme.get_default();
    const requestedScheme = bind(colorScheme, 'colorScheme');
    const group = new Gtk.CheckButton();
    const choices = [
        {mode: DarkModes.AUTO, label: 'Automatic'},
        {mode: DarkModes.LIGHT, label: 'Light Mode'},
        {mode: DarkModes.DARK, label: 'Dark Mode'},
    ].map(({mode, label}) => ({
        mode,
        button: new Gtk.CheckButton({group, label}),
    }));
    let syncing = false;
    const syncChoices = () => {
        syncing = true;
        try {
            for (const {mode, button} of choices) {
                button.active = colorScheme.colorScheme === mode;
            }
        } finally {
            syncing = false;
        }
    };
    for (const {mode, button} of choices) {
        button.connect('toggled', () => {
            if (syncing || !button.active || colorScheme.colorScheme === mode) return;
            try {
                bus.emit(SET_SCHEME, mode);
            } finally {
                syncChoices();
            }
        });
    }
    effect(() => {
        requestedScheme();
        syncChoices();
    });

    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                {choices.map(({button}) => button)}
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickControlButton
                intent="action"
                domain="Theme"
                icon={bind(colorScheme, 'iconName')}
                value={requestedScheme.as((c) => {
                    if (c === DarkModes.AUTO) return 'Auto';
                    if (c === DarkModes.LIGHT) return 'Light Mode';
                    return 'Dark Mode';
                })}
                actionLabel="Cycle theme"
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
                menu={{label: 'Theme options', popover}}
            />
        ),
    };
};
