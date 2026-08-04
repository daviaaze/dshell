import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {ActionButton} from './actionButton';

export const PowerMenu = () => (
    <Gtk.Popover cssClasses={['menu']}>
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
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
                    bus.emit('power:cmd:logout');
                }}
            />
            <ActionButton
                iconName="media-playback-pause-symbolic"
                label="Suspend"
                onClicked={() => {
                    bus.emit('power:cmd:suspend');
                }}
            />
            <ActionButton
                iconName="system-reboot-symbolic"
                label="Reboot"
                onClicked={() => {
                    bus.emit('power:cmd:reboot');
                }}
            />
            <ActionButton
                iconName="system-shutdown-symbolic"
                label="Power Off"
                destructive
                onClicked={() => {
                    bus.emit('power:cmd:poweroff');
                }}
            />
        </Gtk.Box>
    </Gtk.Popover>
);
