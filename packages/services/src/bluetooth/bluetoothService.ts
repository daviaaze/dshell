/**
 * Bluetooth service — wraps AstalBluetooth D-Bus proxy with reactive properties.
 *
 * Handles lazy D-Bus initialization so widgets only bind to reactive properties.
 */
import {Object, register, property} from 'gnim/gobject';
import Bluetooth from 'gi://AstalBluetooth';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';

let _instance: BluetoothService | null = null;

@register
export default class BluetoothService extends Object {
    #bt: Bluetooth.Bluetooth | null = null;
    #initialized = false;

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
            .filter(d => d.connected)
            .map(d => d.name)
            .join(', ');
    }

    @property
    get iconName(): string {
        if (!this.isPowered) return 'bluetooth-disconnected-symbolic';
        return this.isConnected
            ? 'bluetooth-active-symbolic'
            : 'bluetooth-disconnected-symbolic';
    }

    /** Initialize the AstalBluetooth D-Bus proxy. Call once during boot. */
    init(): void {
        if (this.#initialized) return;
        this.#initialized = true;

        try {
            this.#bt = Bluetooth.get_default();
        } catch (e) {
            logger.error(
                'bluetoothService',
                'Failed to init AstalBluetooth:',
                e
            );
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
            this.notify('devices');
            this.notify('connected-device-names');
        });
    }
}
