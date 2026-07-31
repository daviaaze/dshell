import {Object, register} from 'gnim/gobject';
import {Process} from '@shade/core/process';
import logger from '@shade/core/logger';

/**
 * Encapsulates power/session shell commands.
 * Widgets call semantic methods; this service owns the Process.exec calls.
 */
@register
export default class SessionControl extends Object {
    private static instance: SessionControl;

    static get_default() {
        if (!this.instance) this.instance = new SessionControl();
        return this.instance;
    }

    /** Log out the current session via logind. */
    logout() {
        try {
            Process.exec('loginctl terminate-session');
        } catch (e) {
            logger.error('session', 'loginctl terminate-session failed:', e);
        }
    }

    /** Suspend the system via systemd. */
    suspend() {
        try {
            Process.exec('systemctl suspend');
        } catch (e) {
            logger.error('session', 'systemctl suspend failed:', e);
        }
    }

    /** Reboot the system via systemd. */
    reboot() {
        try {
            Process.exec('systemctl reboot');
        } catch (e) {
            logger.error('session', 'systemctl reboot failed:', e);
        }
    }

    /** Power off the system via systemd. */
    powerOff() {
        try {
            Process.exec('systemctl poweroff');
        } catch (e) {
            logger.error('session', 'systemctl poweroff failed:', e);
        }
    }
}
