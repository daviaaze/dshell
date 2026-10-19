import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import Inhibit from '@shade/services/power/inhibit';
import {bind, computed} from 'gnim';
import {LinkedBox} from '../../common/linkedBox';
import {QuickControlButton} from '../../common/quickControlButton';
import type {QuickButton} from './quickButton';

const SET_DURATION = 'power:inhibit:set-duration';
const START_INDEFINITE = 'power:inhibit:start-indefinite';

export default (): QuickButton => {
    const inhibit = Inhibit.get_default();
    const idle = bind(inhibit, 'idle');
    const remaining = bind(inhibit, 'remaining');

    const value = computed(() => {
        if (!idle()) return 'Off';
        const rem = remaining();
        return rem ? `Remaining ${rem}` : 'Indefinitely';
    });

    const icon = computed(() =>
        idle() ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic'
    );

    const actionLabel = computed(() =>
        idle() ? 'Turn sleep prevention off' : 'Prevent sleep indefinitely'
    );
    const popover = (
        <Gtk.Popover cssClasses={[]}>
            <LinkedBox>
                <Gtk.Button onClicked={() => bus.emit(START_INDEFINITE, [])}>
                    <Adw.ButtonContent iconName="weather-clear-symbolic" label="Indefinitely" />
                </Gtk.Button>
                <Gtk.Button onClicked={() => bus.emit(SET_DURATION, 5)}>
                    <Adw.ButtonContent
                        iconName="preferences-system-time-symbolic"
                        label="5 minutes"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => bus.emit(SET_DURATION, 15)}>
                    <Adw.ButtonContent
                        iconName="preferences-system-time-symbolic"
                        label="15 minutes"
                    />
                </Gtk.Button>
                <Gtk.Button onClicked={() => bus.emit(SET_DURATION, 60)}>
                    <Adw.ButtonContent iconName="preferences-system-time-symbolic" label="1 hour" />
                </Gtk.Button>
                <Gtk.Separator visible={bind(inhibit, 'idle')} />
                <Gtk.Button
                    visible={bind(inhibit, 'idle')}
                    onClicked={() => bus.emit('power:inhibit:set-idle', false)}
                >
                    <Adw.ButtonContent iconName="window-close-symbolic" label="Off" />
                </Gtk.Button>
            </LinkedBox>
        </Gtk.Popover>
    );

    return {
        widget: (
            <QuickControlButton
                intent="toggle"
                active={idle}
                icon={icon}
                domain="Sleep prevention"
                value={value}
                actionLabel={actionLabel}
                onClick={() => {
                    if (inhibit.idle) bus.emit('power:inhibit:set-idle', false);
                    else bus.emit(START_INDEFINITE, []);
                }}
                menu={{label: 'Sleep prevention options', popover}}
            />
        ),
    };
};
