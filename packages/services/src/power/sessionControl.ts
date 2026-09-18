import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, register} from 'gnim/gobject';
import {bus} from '../bus';
import {defineService} from '@shade/core/define';

/**
 * Encapsulates power/session actions.
 * Widgets call semantic methods; power state changes go to logind over
 * D-Bus, logout shells out to loginctl.
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

    /** Change power state via systemd-logind on the system bus. */
    #callLogind(method: 'PowerOff' | 'Reboot' | 'Suspend') {
        try {
            Gio.DBus.system.call_sync(
                'org.freedesktop.login1',
                '/org/freedesktop/login1',
                'org.freedesktop.login1.Manager',
                method,
                new GLib.Variant('(b)', [false]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
        } catch (e) {
            logger.error('session', `logind ${method} failed:`, e);
        }
    }

    /** Log out the current session via logind. */
    logout() {
        try {
            const sessionId = GLib.getenv('XDG_SESSION_ID');
            if (sessionId) {
                Process.exec(`loginctl terminate-session ${sessionId}`);
            } else {
                logger.warn('session', 'XDG_SESSION_ID not set, falling back to terminate-user');
                Process.exec(`loginctl terminate-user ${GLib.getenv('USER')}`);
            }
        } catch (e) {
            logger.error('session', 'logout failed:', e);
        }
    }

    /** Suspend the system via logind. */
    suspend() {
        this.#callLogind('Suspend');
    }

    /** Reboot the system via logind. */
    reboot() {
        this.#callLogind('Reboot');
    }

    /** Power off the system via logind. */
    powerOff() {
        this.#callLogind('PowerOff');
    }
}
defineService({name: 'SessionControl', service: SessionControl.get_default()});
