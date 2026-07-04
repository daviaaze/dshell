import Gtk from 'gi://Gtk?version=4.0';
import ShellState from '#/lib/shellState';
import logger from '#/lib/logger';
import {Process} from '#/lib/process';
import {ActionButton} from './actionButton.tsx';

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
                        ShellState.get_default().screenlocked = true;
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-log-out-symbolic"
                    label="Log Out"
                    onClicked={() => {
                        try {
                            Process.exec('loginctl terminate-session');
                        } catch (e) {
                            logger.error('power', 'loginctl failed:', e);
                        }
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="media-playback-pause-symbolic"
                    label="Suspend"
                    onClicked={() => {
                        try {
                            Process.exec('systemctl suspend');
                        } catch (e) {
                            logger.error(
                                'power',
                                'systemctl suspend failed:',
                                e
                            );
                        }
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-reboot-symbolic"
                    label="Reboot"
                    onClicked={() => {
                        try {
                            Process.exec('systemctl reboot');
                        } catch (e) {
                            logger.error(
                                'power',
                                'systemctl reboot failed:',
                                e
                            );
                        }
                        popover.popdown();
                    }}
                />
                <ActionButton
                    iconName="system-shutdown-symbolic"
                    label="Power Off"
                    destructive
                    onClicked={() => {
                        try {
                            Process.exec('systemctl poweroff');
                        } catch (e) {
                            logger.error(
                                'power',
                                'systemctl poweroff failed:',
                                e
                            );
                        }
                        popover.popdown();
                    }}
                />
            </Gtk.Box>
        </Gtk.Popover>
    ) as Gtk.Popover;

    return popover;
};
