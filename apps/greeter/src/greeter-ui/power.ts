/**
 * Power actions for the greeter (shutdown / reboot from the login screen).
 *
 * Calls systemd-logind over D-Bus with interactive=false — the greeter
 * runs in its own seat session under greetd, which logind's default
 * polkit rules allow to power off / reboot without authentication.
 */
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';

/** Asynchronous so a stalled logind cannot freeze the login screen. */
const LOGIND_TIMEOUT_MS = 10000;

function callLogind(
    method: 'PowerOff' | 'Reboot',
    failureMessage: string,
    onError: (message: string) => void
): void {
    const fail = (e: unknown): void => {
        logger.error('greeter', `logind ${method} failed: ${e}`);
        onError(failureMessage);
    };
    try {
        const bus = Gio.DBus.system;
        bus.call(
            'org.freedesktop.login1',
            '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager',
            method,
            new GLib.Variant('(b)', [false]),
            null,
            Gio.DBusCallFlags.NONE,
            LOGIND_TIMEOUT_MS,
            null,
            (_source, result) => {
                try {
                    bus.call_finish(result);
                } catch (e) {
                    fail(e);
                }
            }
        );
    } catch (e) {
        fail(e);
    }
}

export function powerOff(onError: (message: string) => void): void {
    callLogind('PowerOff', 'Não foi possível desligar o computador.', onError);
}

export function reboot(onError: (message: string) => void): void {
    callLogind('Reboot', 'Não foi possível reiniciar o computador.', onError);
}
