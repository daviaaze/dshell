#!/usr/bin/env -S gjs

// Guest-only fprintd protocol fixture. This exercises Shade's D-Bus client path
// only; it is not a reader, enrollment service, PAM authenticator, or biometric
// security mechanism. Always pass an explicit private dbus-daemon socket.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SERVICE = 'net.reactivated.Fprint';
const MANAGER_PATH = '/net/reactivated/Fprint/Manager';
const DEVICE_PATH = '/net/reactivated/Fprint/Device/0';
const DEVICE_INTERFACE = 'net.reactivated.Fprint.Device';
const MANAGER_INTERFACE = 'net.reactivated.Fprint.Manager';
const SEQUENCE = ['active-hold', 'no-match-retry', 'mock-match'];
const DEFAULT_HOLD_MS = 10000;
const DEFAULT_RETRY_MS = 1000;

const XML = `
<node>
  <interface name="${MANAGER_INTERFACE}">
    <method name="GetDevices">
      <arg name="devices" type="ao" direction="out"/>
    </method>
  </interface>
  <interface name="${DEVICE_INTERFACE}">
    <method name="Claim">
      <arg name="username" type="s" direction="in"/>
    </method>
    <method name="VerifyStart">
      <arg name="finger" type="s" direction="in"/>
    </method>
    <method name="VerifyStop"/>
    <method name="Release"/>
    <signal name="VerifyStatus">
      <arg name="result" type="s"/>
      <arg name="done" type="b"/>
    </signal>
  </interface>
</node>`;

function usage() {
    printerr(`Usage: gjs scripts/vm-fprintd-mock.js --socket /absolute/path/to/private-bus.sock \\
  --sequence active-hold,no-match-retry,mock-match [--hold-ms 10000] [--retry-ms 1000]

The socket must belong to a private guest dbus-daemon. This program connects
only to that explicit unix socket; it does not use the session or system bus.`);
}

function parseArgs(args) {
    const options = {socket: null, sequence: null, holdMs: DEFAULT_HOLD_MS, retryMs: DEFAULT_RETRY_MS};
    for (let index = 0; index < args.length; index++) {
        const key = args[index];
        if (!['--socket', '--sequence', '--hold-ms', '--retry-ms'].includes(key) || index + 1 >= args.length) {
            throw new Error(`Unknown or incomplete argument: ${key}`);
        }
        const value = args[++index];
        if (key === '--socket') options.socket = value;
        else if (key === '--sequence') options.sequence = value.split(',');
        else if (key === '--hold-ms') options.holdMs = Number(value);
        else options.retryMs = Number(value);
    }

    if (!options.socket || !GLib.path_is_absolute(options.socket)) {
        throw new Error('--socket is required and must be an absolute filesystem path');
    }
    if (!options.sequence || options.sequence.join(',') !== SEQUENCE.join(',')) {
        throw new Error(`--sequence is required and must be exactly: ${SEQUENCE.join(',')}`);
    }
    for (const [name, value] of [['--hold-ms', options.holdMs], ['--retry-ms', options.retryMs]]) {
        if (!Number.isSafeInteger(value) || value < 100) {
            throw new Error(`${name} must be an integer of at least 100 milliseconds`);
        }
    }
    return options;
}

function log(event, fields = {}) {
    print(JSON.stringify({time: new Date().toISOString(), event, ...fields}));
}

function main() {
    let options;
    try {
        options = parseArgs(ARGV);
    } catch (error) {
        printerr(error.message);
        usage();
        return 2;
    }

    // Use only the explicitly supplied unix socket; do not use Gio.BusType.SYSTEM,
    // Gio.BusType.SESSION, DBUS_SYSTEM_BUS_ADDRESS, or an implicit bus lookup.
    const address = `unix:path=${GLib.uri_escape_string(options.socket, '/', true)}`;
    let connection;
    try {
        connection = Gio.DBusConnection.new_for_address_sync(
            address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
                Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            null,
            null
        );
    } catch (error) {
        printerr(`Cannot connect to the explicit private bus socket: ${error.message}`);
        return 1;
    }

    const loop = new GLib.MainLoop(null, false);
    const introspection = Gio.DBusNodeInfo.new_for_xml(XML);
    const managerInfo = introspection.lookup_interface(MANAGER_INTERFACE);
    const deviceInfo = introspection.lookup_interface(DEVICE_INTERFACE);
    let managerRegistration = 0;
    let deviceRegistration = 0;
    let nameOwnerId = 0;
    let firstVerify = true;
    let active = false;
    let holdTimer = 0;
    let matchTimer = 0;
    let exitCode = 0;

    const clearTimer = (source) => {
        if (source) GLib.source_remove(source);
        return 0;
    };
    const emitStatus = (status, done) => {
        log('signal', {path: DEVICE_PATH, interface: DEVICE_INTERFACE, name: 'VerifyStatus', status, done});
        connection.emit_signal(null, DEVICE_PATH, DEVICE_INTERFACE, 'VerifyStatus',
            new GLib.Variant('(sb)', [status, done]));
    };
    const methodLog = (method, fields = {}) => log('method', {path: DEVICE_PATH, interface: DEVICE_INTERFACE, method, ...fields});

    try {
        managerRegistration = connection.register_object(MANAGER_PATH, managerInfo, {
            method_call(_connection, _sender, objectPath, interfaceName, methodName, _parameters, invocation) {
                log('method', {path: objectPath, interface: interfaceName, method: methodName});
                if (methodName === 'GetDevices') {
                    invocation.return_value(new GLib.Variant('(ao)', [[DEVICE_PATH]]));
                } else {
                    invocation.return_dbus_error(`${MANAGER_INTERFACE}.UnknownMethod`, `Unsupported method ${methodName}`);
                }
            },
        });
        deviceRegistration = connection.register_object(DEVICE_PATH, deviceInfo, {
            method_call(_connection, _sender, objectPath, interfaceName, methodName, parameters, invocation) {
                const args = parameters ? parameters.deep_unpack() : [];
                methodLog(methodName, args.length ? {arguments: args} : {});
                switch (methodName) {
                case 'Claim':
                    invocation.return_value(null);
                    break;
                case 'VerifyStart':
                    if (firstVerify) {
                        firstVerify = false;
                        active = true;
                        emitStatus('verify-swipe-too-short', false);
                        holdTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.holdMs, () => {
                            holdTimer = 0;
                            if (active) {
                                active = false;
                                emitStatus('verify-no-match', true);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        active = true;
                        matchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.retryMs, () => {
                            matchTimer = 0;
                            if (active) {
                                active = false;
                                emitStatus('verify-match', true);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    invocation.return_value(null);
                    break;
                case 'VerifyStop':
                    active = false;
                    holdTimer = clearTimer(holdTimer);
                    matchTimer = clearTimer(matchTimer);
                    invocation.return_value(null);
                    break;
                case 'Release':
                    invocation.return_value(null);
                    break;
                default:
                    invocation.return_dbus_error(`${DEVICE_INTERFACE}.UnknownMethod`, `Unsupported method ${methodName}`);
                }
            },
        });

        nameOwnerId = Gio.bus_own_name_on_connection(
            connection,
            SERVICE,
            Gio.BusNameOwnerFlags.NONE,
            () => {
                log('ready', {service: SERVICE, socket: options.socket, device: DEVICE_PATH, sequence: SEQUENCE});
            },
            (_connection, name) => {
                log('name-lost', {service: name});
                exitCode = 1;
                loop.quit();
            }
        );

        const quit = (signalName) => {
            log('shutdown', {signal: signalName});
            loop.quit();
            return GLib.SOURCE_REMOVE;
        };
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, () => quit('SIGINT'));
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, () => quit('SIGTERM'));
        loop.run();
    } catch (error) {
        printerr(`fprintd fixture failed: ${error.message}`);
        exitCode = 1;
    } finally {
        holdTimer = clearTimer(holdTimer);
        matchTimer = clearTimer(matchTimer);
        if (nameOwnerId) Gio.bus_unown_name(nameOwnerId);
        if (managerRegistration) connection.unregister_object(managerRegistration);
        if (deviceRegistration) connection.unregister_object(deviceRegistration);
        try {
            connection.close_sync(null);
        } catch (error) {
            log('close-error', {message: error.message});
            exitCode = 1;
        }
    }
    return exitCode;
}

System.exit(main());
