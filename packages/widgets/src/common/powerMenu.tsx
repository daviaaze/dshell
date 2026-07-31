import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import SessionControl from '@shade/services/power/sessionControl';
import {ActionButton} from './actionButton';

export const PowerMenu = () => (
    <Gtk.Popover cssClasses={['menu']}>
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            cssClasses={['popover-padded-lg']}
        >
            <ActionButton
                iconName="system-lock-screen-symbolic"
                label="Lock"
                onClicked={() => {
                    bus.emit('shell:lock');
                }}
            />
            <ActionButton
                iconName="system-log-out-symbolic"
                label="Log Out"
                onClicked={() => {
                    SessionControl.get_default().logout();
                }}
            />
            <ActionButton
                iconName="media-playback-pause-symbolic"
                label="Suspend"
                onClicked={() => {
                    SessionControl.get_default().suspend();
                }}
            />
            <ActionButton
                iconName="system-reboot-symbolic"
                label="Reboot"
                onClicked={() => {
                    SessionControl.get_default().reboot();
                }}
            />
            <ActionButton
                iconName="system-shutdown-symbolic"
                label="Power Off"
                destructive
                onClicked={() => {
                    SessionControl.get_default().powerOff();
                }}
            />
        </Gtk.Box>
    </Gtk.Popover>
);
