import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {presentPowerConfirmation, type ConfirmablePowerAction} from './powerConfirmation';

const POWER_EVENTS: Record<ConfirmablePowerAction, 'power:cmd:logout' | 'power:cmd:reboot' | 'power:cmd:poweroff'> = {
    logout: 'power:cmd:logout', reboot: 'power:cmd:reboot', poweroff: 'power:cmd:poweroff',
};
const POWER_CHOICES: {action: ConfirmablePowerAction; label: string; icon: string}[] = [
    {action: 'logout', label: 'Log Out', icon: 'system-log-out-symbolic'},
    {action: 'reboot', label: 'Restart', icon: 'system-reboot-symbolic'},
    {action: 'poweroff', label: 'Power Off', icon: 'system-shutdown-symbolic'},
];

export const PowerMenu = () => (
    <Gtk.Popover cssClasses={['menu']}>
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <Gtk.Button cssClasses={['flat']} onClicked={() => bus.emit('shell:lock')}>
                <Adw.ButtonContent iconName="system-lock-screen-symbolic" label="Lock" />
            </Gtk.Button>
            <Gtk.Button cssClasses={['flat']} onClicked={() => bus.emit('power:cmd:suspend')}>
                <Adw.ButtonContent iconName="media-playback-pause-symbolic" label="Suspend" />
            </Gtk.Button>
            {POWER_CHOICES.map(({action, label, icon}) => (
                <Gtk.Button cssClasses={['flat']} onClicked={(self) =>
                    presentPowerConfirmation(self, action, () => bus.emit(POWER_EVENTS[action]))}>
                    <Adw.ButtonContent iconName={icon} label={label} />
                </Gtk.Button>
            ))}
        </Gtk.Box>
    </Gtk.Popover>
);
