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

function callLogind(method: 'PowerOff' | 'Reboot'): void {
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
        logger.error('greeter', `logind ${method} failed: ${e}`);
    }
}

export function powerOff(): void {
    callLogind('PowerOff');
}

export function reboot(): void {
    callLogind('Reboot');
}
