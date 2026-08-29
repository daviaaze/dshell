import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, register} from 'gnim/gobject';
import {bus} from '../bus';
import {defineService} from '@shade/core/define';

/**
 * Encapsulates power/session shell commands.
 * Widgets call semantic methods; this service owns the Process.exec calls.
 */
@register
export default class SessionControl extends Object {
    private static instance: SessionControl;
    #busSubscriptions: (() => void)[] = [];

    static get_default() {
        if (!SessionControl.instance) {
            SessionControl.instance = new SessionControl();
            SessionControl.instance.#initBus();
        }
        return SessionControl.instance;
    }

    #initBus() {
        this.#busSubscriptions.push(bus.on('power:cmd:logout', () => this.logout()));
        this.#busSubscriptions.push(bus.on('power:cmd:suspend', () => this.suspend()));
        this.#busSubscriptions.push(bus.on('power:cmd:reboot', () => this.reboot()));
        this.#busSubscriptions.push(bus.on('power:cmd:poweroff', () => this.powerOff()));
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
defineService({name: 'SessionControl', service: SessionControl.get_default()});
