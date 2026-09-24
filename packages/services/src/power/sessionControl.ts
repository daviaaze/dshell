import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, register} from 'gnim/gobject';
import {bus} from '../bus';
import {defineService} from '@shade/core/define';

function reportLogoutFailure(message: string) {
    Process.execAsyncv([
        'notify-send',
        '-a',
        'shade-shell',
        '-i',
        'dialog-error-symbolic',
        'Log Out Failed',
        message,
    ]).catch((e) => logger.warn('session', 'logout error notification failed:', e));
}

/** Terminate only the specified session; dependencies are injectable for tests. */
export function logoutCurrentSession(
    sessionId: string | null,
    execute: (argv: string[]) => string = (argv) => Process.execv(argv),
    showError: (message: string) => void = reportLogoutFailure
): boolean {
    let error: unknown;
    const id = sessionId?.trim();
    if (!id) {
        error = new Error('XDG_SESSION_ID is not set');
    } else {
        try {
            execute(['loginctl', 'terminate-session', id]);
            return true;
        } catch (e) {
            error = e;
        }
    }

    const detail = error instanceof Error ? error.message : String(error);
    logger.error('session', 'logout failed:', error);
    showError(`Could not end the current session: ${detail}`);
    return false;
}

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

    /** Log out only the current XDG session via logind. */
    logout() {
        logoutCurrentSession(GLib.getenv('XDG_SESSION_ID'));
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
