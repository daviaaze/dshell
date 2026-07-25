import Gtk from 'gi://Gtk?version=4.0';
import ShellState from '#/lib/services/state/shellState';
import SessionControl from '#/lib/services/power/sessionControl';
import {ActionButton} from './actionButton';

export const PowerMenu = () => {
    const popover = (
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
                        ShellState.get_default().lock();
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-log-out-symbolic"
                    label="Log Out"
                    onClicked={() => {
                        SessionControl.get_default().logout();
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="media-playback-pause-symbolic"
                    label="Suspend"
                    onClicked={() => {
                        SessionControl.get_default().suspend();
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-reboot-symbolic"
                    label="Reboot"
                    onClicked={() => {
                        SessionControl.get_default().reboot();
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-shutdown-symbolic"
                    label="Power Off"
                    destructive
                    onClicked={() => {
                        SessionControl.get_default().powerOff();
                        popover.popdown();
                    }}
                />
            </Gtk.Box>
        </Gtk.Popover>
    ) as any;

    return popover;
};
