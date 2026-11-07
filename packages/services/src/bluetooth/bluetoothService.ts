/**
 * Bluetooth service — wraps AstalBluetooth D-Bus proxy with reactive properties.
 *
 * Handles lazy D-Bus initialization so widgets only bind to reactive properties.
 */

import Bluetooth from 'gi://AstalBluetooth';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import {defineService} from '@shade/core/define';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';

let _instance: BluetoothService | null = null;

@register
export default class BluetoothService extends Object {
    #bt: Bluetooth.Bluetooth | null = null;
    #initialized = false;
    #pairedHandlers: Map<Bluetooth.Device, number>;

    constructor() {
        super();
        this.#pairedHandlers = new Map();
    }

    #disconnectPairedHandlers(): void {
        for (const [device, handler] of this.#pairedHandlers) {
            if (GObject.signal_handler_is_connected(device, handler)) {
                device.disconnect(handler);
            }
        }
        this.#pairedHandlers.clear();
    }

    #reconcilePairedHandlers(): void {
        const devices = this.#bt?.devices ? toArray<Bluetooth.Device>(this.#bt.devices) : [];
        const current = new Set(devices);

        for (const [device, handler] of this.#pairedHandlers) {
            if (!current.has(device)) {
                if (GObject.signal_handler_is_connected(device, handler)) {
                    device.disconnect(handler);
                }
                this.#pairedHandlers.delete(device);
            }
        }

        for (const device of devices) {
            if (this.#pairedHandlers.has(device)) continue;
            const handler = device.connect('notify::paired', () => {
                this.notify('devices');
                this.notify('connected-device-names');
            });
            this.#pairedHandlers.set(device, handler);
        }
    }

    static get_default(): BluetoothService {
        if (!_instance) _instance = new BluetoothService();
        return _instance;
    }

    @property
    get isPowered(): boolean {
        return this.#bt?.isPowered ?? false;
    }

    @property
    get isConnected(): boolean {
        return this.#bt?.isConnected ?? false;
    }

    @property
    get devices(): Bluetooth.Device[] {
        if (!this.#bt?.devices) return [];
        return toArray<Bluetooth.Device>(this.#bt.devices);
    }

    @property
    get connectedDeviceNames(): string {
        return this.devices
            .filter((d) => d.connected)
            .map((d) => d.name)
            .join(', ');
    }

    @property
    get iconName(): string {
        if (!this.isPowered) return 'bluetooth-disconnected-symbolic';
        return this.isConnected ? 'bluetooth-active-symbolic' : 'bluetooth-disconnected-symbolic';
    }

    pairDevice(device: Bluetooth.Device): Promise<void> {
        // Let BlueZ, rather than the default D-Bus timeout, finish authentication.
        const path = `${device.adapter}/dev_${device.address.replaceAll(':', '_')}`;
        return this.#callBluez(path, 'org.bluez.Device1', 'Pair', null, GLib.MAXINT32);
    }

    forgetDevice(device: Bluetooth.Device): Promise<void> {
        const path = `${device.adapter}/dev_${device.address.replaceAll(':', '_')}`;
        return this.#callBluez(
            device.adapter,
            'org.bluez.Adapter1',
            'RemoveDevice',
            new GLib.Variant('(o)', [path]),
            -1
        );
    }

    #callBluez(
        path: string,
        iface: string,
        method: string,
        parameters: GLib.Variant | null,
        timeout: number
    ): Promise<void> {
        const {promise, resolve, reject} = Promise.withResolvers<void>();
        Gio.bus_get(Gio.BusType.SYSTEM, null, (_source, result) => {
            let bus: Gio.DBusConnection;
            try {
                bus = Gio.bus_get_finish(result);
            } catch (error) {
                reject(error);
                return;
            }
            bus.call(
                'org.bluez',
                path,
                iface,
                method,
                parameters,
                null,
                Gio.DBusCallFlags.NONE,
                timeout,
                null,
                (_connection, reply) => {
                    try {
                        bus.call_finish(reply);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
        return promise;
    }

    connectDevice(device: Bluetooth.Device): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            device.connect_device((_, result) => {
                try {
                    device.connect_device_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    disconnectDevice(device: Bluetooth.Device): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            device.disconnect_device((_, result) => {
                try {
                    device.disconnect_device_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /** Initialize the AstalBluetooth D-Bus proxy. Call once during boot. */
    init(): void {
        if (this.#initialized) return;
        this.#initialized = true;

        try {
            this.#bt = Bluetooth.get_default();
        } catch (e) {
            logger.error('bluetoothService', 'Failed to init AstalBluetooth:', e);
            return;
        }

        this.#bt.connect('notify::is-powered', () => {
            this.notify('is-powered');
            this.notify('icon-name');
            this.notify('is-connected');
        });
        this.#bt.connect('notify::is-connected', () => {
            this.notify('is-connected');
            this.notify('icon-name');
            this.notify('connected-device-names');
        });
        this.#bt.connect('notify::devices', () => {
            this.#reconcilePairedHandlers();
            this.notify('devices');
            this.notify('connected-device-names');
        });
        this.#reconcilePairedHandlers();
    }
}

defineService({name: 'BluetoothService', service: BluetoothService.get_default()});
