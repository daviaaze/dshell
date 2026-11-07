import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {presentPowerConfirmation, type ConfirmablePowerAction} from './powerConfirmation';

const POWER_EVENTS: Record<ConfirmablePowerAction, 'power:cmd:logout' | 'power:cmd:reboot' | 'power:cmd:poweroff'> = {
    logout: 'power:cmd:logout', reboot: 'power:cmd:reboot', poweroff: 'power:cmd:poweroff',
};
const POWER_CHOICES: {action: ConfirmablePowerAction; label: string; icon: string}[] = [
    {action: 'logout', label: 'Sair da sessão', icon: 'system-log-out-symbolic'},
    {action: 'reboot', label: 'Reiniciar', icon: 'system-reboot-symbolic'},
    {action: 'poweroff', label: 'Desligar', icon: 'system-shutdown-symbolic'},
];

const ConfirmPowerButton = ({action, label, icon}: {action: ConfirmablePowerAction; label: string; icon: string}) => (
    <Gtk.Button cssClasses={['flat']} onClicked={self =>
        presentPowerConfirmation(self, action, () => bus.emit(POWER_EVENTS[action]))}>
        <Adw.ButtonContent iconName={icon} label={label} />
    </Gtk.Button>
);

export const PowerMenu = () => (
    <Gtk.Popover cssClasses={['background', 'menu']}>
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}
            marginTop={8} marginBottom={8} marginStart={8} marginEnd={8}>
            <Gtk.Label label="Sessão" cssClasses={['heading']} xalign={0} marginStart={8} />
            <Gtk.Button cssClasses={['flat']} onClicked={() => bus.emit('shell:lock')}>
                <Adw.ButtonContent iconName="system-lock-screen-symbolic" label="Bloquear" />
            </Gtk.Button>
            <Gtk.Button cssClasses={['flat']} onClicked={() => bus.emit('power:cmd:suspend')}>
                <Adw.ButtonContent iconName="media-playback-pause-symbolic" label="Suspender" />
            </Gtk.Button>
            {POWER_CHOICES.filter(choice => choice.action === 'logout').map(choice => <ConfirmPowerButton {...choice} />)}
            <Gtk.Separator marginTop={4} marginBottom={4} />
            <Gtk.Label label="Computador" cssClasses={['heading']} xalign={0} marginStart={8} />
            {POWER_CHOICES.filter(choice => choice.action !== 'logout').map(choice => <ConfirmPowerButton {...choice} />)}
        </Gtk.Box>
    </Gtk.Popover>
);
