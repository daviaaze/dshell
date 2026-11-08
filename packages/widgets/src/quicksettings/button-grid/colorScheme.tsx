import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {ColorScheme, DarkModes} from '@shade/services/display/colorScheme';
import {bind, effect} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickDetailButton} from './quickButton';

const SET_SCHEME = 'display:colorscheme:set';

export default (onOpen: (self: Gtk.Button) => void): QuickDetailButton => {
    const colorScheme = ColorScheme.get_default();
    const requestedScheme = bind(colorScheme, 'colorScheme');
    const group = new Gtk.CheckButton();
    const choices = [
        {mode: DarkModes.AUTO, label: 'Automático'},
        {mode: DarkModes.LIGHT, label: 'Modo claro'},
        {mode: DarkModes.DARK, label: 'Modo escuro'},
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

    const detail = <LinkedBox>{choices.map(({button}) => button)}</LinkedBox>;

    return {
        detail,
        widget: (
            <QuickControlButton
                intent="action"
                domain="Tema"
                icon={bind(colorScheme, 'iconName')}
                value={requestedScheme.as((c) => {
                    if (c === DarkModes.AUTO) return 'Automático';
                    if (c === DarkModes.LIGHT) return 'Modo claro';
                    return 'Modo escuro';
                })}
                actionLabel="Alternar tema"
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
                detail={{label: 'Opções de tema', onOpen}}
            />
        ),
    };
};
