import AstalBattery from 'gi://AstalBattery';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import ServiceRegistry from '@shade/core/serviceRegistry';
import {generalSettings} from '@shade/core/settings/general.gschema';
import BluetoothService from '../bluetooth/bluetoothService';
import {getDeviceBatteryPercentage, retainBluetoothBatteryDevices} from '../monitoring/bluetoothBattery';
import SystemUsage from '../monitoring/systemUsage';
import {
    buildAlertNotification,
    createBatteryState,
    createBluetoothState,
    createTemperatureState,
    decideBatteryAlerts,
    decideBluetoothAlerts,
    decideTemperatureAlert,
    temperatureCelsius,
    type AlertNotification,
    type SystemAlert,
} from './alerts';

const NOTIFICATION_BUS = 'org.freedesktop.Notifications';
type Settings = ReturnType<typeof generalSettings>;

/** Serialize each key so an escalation always replaces the ID returned by its predecessor. */
export class DesktopAlertPublisher {
    #ids = new Map<string, number>();
    #pending = new Map<string, Promise<void>>();
    #generation = 0;

    constructor(private readonly send: (content: AlertNotification, replacesId: number) => Promise<number>) {}

    publish(alert: SystemAlert, revealDeviceName = true): Promise<void> {
        const generation = this.#generation;
        const task = (this.#pending.get(alert.key) ?? Promise.resolve()).catch(() => {}).then(async () => {
            if (generation !== this.#generation) return;
            const id = await this.send(buildAlertNotification(alert, revealDeviceName), this.#ids.get(alert.key) ?? 0);
            if (generation === this.#generation) this.#ids.set(alert.key, id);
        });
        this.#pending.set(alert.key, task);
        return task.finally(() => {
            if (this.#pending.get(alert.key) === task) this.#pending.delete(alert.key);
        });
    }

    reset(): void {
        this.#generation++;
        this.#ids.clear();
        this.#pending.clear();
    }
}

export default class SystemAlertService {
    private static instance: SystemAlertService;

    static get_default(): SystemAlertService {
        if (!SystemAlertService.instance) SystemAlertService.instance = new SystemAlertService();
        return SystemAlertService.instance;
    }

    #settings: Settings | null = null;
    #battery: AstalBattery.Device | null = null;
    #upower: AstalBattery.UPower | null = null;
    #batteryState = createBatteryState();
    #temperatureState = createTemperatureState();
    #bluetoothState = createBluetoothState();
    #listeners = new Set<(alert: SystemAlert) => void>();
    #connections: {source: {disconnect(id: number): void}; id: number}[] = [];
    #linePowerConnections: {source: AstalBattery.Device; id: number}[] = [];
    #unsubscribers: (() => void)[] = [];
    #timer = 0;
    #sampleIdle = 0;
    #nameWatch = 0;
    #owner: string | null | undefined;
    #cancellable: Gio.Cancellable | null = null;
    #publisher = new DesktopAlertPublisher((content, replacesId) => this.#send(content, replacesId));

    /** Sounds consume exactly the same debounced/hysteretic decisions as notifications. */
    onAlert(listener: (alert: SystemAlert) => void): () => void {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }

    init(settings: Settings): void {
        if (this.#settings) return;
        this.#settings = settings;
        this.#cancellable = new Gio.Cancellable();
        try {
            this.#battery = AstalBattery.get_default();
            this.#connections.push({source: this.#battery,
                id: this.#battery.connect('notify', () => this.#queueSample())});
            this.#upower = AstalBattery.UPower.new();
            for (const signal of ['device-added', 'device-removed'] as const) {
                this.#connections.push({source: this.#upower, id: this.#upower.connect(signal, () => {
                    this.#reconcileLinePower();
                    this.#queueSample();
                })});
            }
            this.#connections.push({source: this.#upower,
                id: this.#upower.connect('notify::on-battery', () => this.#queueSample())});
            this.#reconcileLinePower();
        } catch (error) {
            logger.warn('alerts', 'Battery/UPower unavailable:', error);
        }
        const bluetooth = BluetoothService.get_default();
        this.#connections.push({source: bluetooth,
            id: bluetooth.connect('notify', (_source, pspec) => {
                if (pspec.get_name() !== 'devices') return;
                retainBluetoothBatteryDevices(bluetooth.devices);
                this.#queueSample();
            })});
        const usage = SystemUsage.get_default();
        // Keep the local monitor active even when its bar indicator is hidden. Never use remoteSystemUsage.
        this.#unsubscribers.push(usage.subscribe());
        this.#unsubscribers.push(usage.temp.subscribe(() => this.#queueSample()));
        this.#unsubscribers.push(usage.tempAvailable.subscribe(() => this.#queueSample()));
        this.#nameWatch = Gio.bus_watch_name(
            Gio.BusType.SESSION, NOTIFICATION_BUS, Gio.BusNameWatcherFlags.NONE,
            (_connection, _name, owner) => this.#notificationOwnerChanged(owner),
            () => this.#notificationOwnerChanged(null)
        );
        this.#queueSample();
        // Also matures Bluetooth debounce and pending cooldowns without relying on another property change.
        this.#timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#sample();
            return GLib.SOURCE_CONTINUE;
        });
    }

    #notificationOwnerChanged(owner: string | null): void {
        if (this.#owner !== undefined && this.#owner !== owner) this.#publisher.reset();
        this.#owner = owner;
    }

    #reconcileLinePower(): void {
        const devices = this.#upower?.get_devices().filter((device) =>
            device.get_device_type() === AstalBattery.Type.LINE_POWER) ?? [];
        for (const connection of this.#linePowerConnections) {
            connection.source.disconnect(connection.id);
        }
        this.#linePowerConnections = devices.map((source) => ({source,
            id: source.connect('notify::online', () => this.#queueSample())}));
    }

    #queueSample(): void {
        if (this.#sampleIdle || !this.#settings) return;
        this.#sampleIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#sampleIdle = 0;
            this.#sample();
            return GLib.SOURCE_REMOVE;
        });
    }

    #sample(): void {
        const settings = this.#settings;
        if (!settings) return;
        const now = GLib.get_monotonic_time() / 1000;
        const battery = this.#battery;
        const linePower = this.#upower?.get_devices().filter((device) =>
            device.get_device_type() === AstalBattery.Type.LINE_POWER) ?? [];
        const plugged = linePower.length > 0 ? linePower.some((device) => device.online)
            : battery?.isPresent && this.#upower ? !this.#upower.onBattery : null;
        const power = decideBatteryAlerts(this.#batteryState, {
            percentage: battery ? battery.percentage * 100 : Number.NaN,
            present: battery?.isPresent ?? false,
            discharging: battery?.state === AstalBattery.State.DISCHARGING,
            plugged,
        }, now, {low: settings.alertBatteryLowThreshold(), critical: settings.alertBatteryCriticalThreshold()});
        this.#batteryState = power.state;
        for (const alert of power.alerts) this.#emit(alert);

        const usage = SystemUsage.get_default();
        const temperature = decideTemperatureAlert(this.#temperatureState,
            temperatureCelsius(usage.temp(), usage.tempAvailable()), now,
            {warning: settings.alertTemperatureWarningThreshold(), critical: settings.alertTemperatureCriticalThreshold()});
        this.#temperatureState = temperature.state;
        if (temperature.alert) this.#emit(temperature.alert);

        const devices = BluetoothService.get_default().devices;
        retainBluetoothBatteryDevices(devices);
        const bluetooth = decideBluetoothAlerts(this.#bluetoothState, devices.map((device) => ({
            id: `${device.adapter}/${device.address}`,
            name: device.alias || device.name || '',
            connected: device.connected,
            percentage: device.connected ? getDeviceBatteryPercentage(device) : null,
        })), now, {low: settings.alertBluetoothBatteryThreshold()});
        this.#bluetoothState = bluetooth.state;
        for (const alert of bluetooth.alerts) this.#emit(alert);
    }

    #emit(alert: SystemAlert): void {
        const settings = this.#settings;
        if (!settings) return;
        for (const listener of this.#listeners) {
            try { listener(alert); } catch (error) { logger.warn('alerts', 'Alert listener failed:', error); }
        }
        let enabled: boolean;
        switch (alert.kind) {
            case 'battery-low': case 'battery-critical': enabled = settings.alertBatteryEnabled(); break;
            case 'power-plug': case 'power-unplug': enabled = settings.alertPowerEnabled(); break;
            case 'temperature-warning': case 'temperature-critical': enabled = settings.alertTemperatureEnabled(); break;
            case 'bluetooth-connected': case 'bluetooth-disconnected': enabled = settings.alertBluetoothEnabled(); break;
            case 'bluetooth-battery-low': enabled = settings.alertBluetoothBatteryEnabled(); break;
        }
        if (!enabled || settings.notificationIgnoredApps().some((name) => name.toLowerCase() === 'shade')) return;
        const shell = ServiceRegistry.get_default().resolve<{screenlocked: boolean}>('ShellState');
        const revealName = !shell.screenlocked || settings.notificationLockscreenContent();
        this.#publisher.publish(alert, revealName).catch((error) => {
            logger.warn('alerts', 'Could not send system notification:', error);
        });
    }

    #send(content: AlertNotification, replacesId: number): Promise<number> {
        const {promise, resolve, reject} = Promise.withResolvers<number>();
        try {
            const connection = Gio.DBus.session;
            connection.call(
                NOTIFICATION_BUS,
                '/org/freedesktop/Notifications',
                NOTIFICATION_BUS,
                'Notify',
                new GLib.Variant('(susssasa{sv}i)', ['Shade', replacesId, content.icon, content.summary,
                    content.body, [], {urgency: new GLib.Variant('y', content.urgency),
                        'suppress-sound': new GLib.Variant('b', true)}, content.urgency === 2 ? 0 : -1]),
                new GLib.VariantType('(u)'),
                Gio.DBusCallFlags.NONE,
                5000,
                this.#cancellable,
                (_source, result) => {
                    try {
                        const reply = connection.call_finish(result);
                        resolve(reply.get_child_value(0).get_uint32());
                    } catch (error) { reject(error); }
                }
            );
        } catch (error) { reject(error); }
        return promise;
    }

    dispose(): void {
        if (this.#timer) GLib.source_remove(this.#timer);
        if (this.#sampleIdle) GLib.source_remove(this.#sampleIdle);
        if (this.#nameWatch) Gio.bus_unwatch_name(this.#nameWatch);
        this.#timer = this.#sampleIdle = this.#nameWatch = 0;
        this.#cancellable?.cancel();
        this.#cancellable = null;
        for (const {source, id} of [...this.#connections, ...this.#linePowerConnections]) source.disconnect(id);
        this.#connections = [];
        this.#linePowerConnections = [];
        for (const unsubscribe of this.#unsubscribers) unsubscribe();
        this.#unsubscribers = [];
        retainBluetoothBatteryDevices([]);
        this.#publisher.reset();
        this.#battery = null;
        this.#upower = null;
        this.#owner = undefined;
        this.#settings = null;
        this.#batteryState = createBatteryState();
        this.#temperatureState = createTemperatureState();
        this.#bluetoothState = createBluetoothState();
    }
}

// The sensor/Bluetooth services must be initialized before the first baseline snapshot.
defineService({name: 'SystemAlerts', service: SystemAlertService.get_default(),
    dependsOn: ['SystemUsage', 'BluetoothService', 'ShellState'], initArgs: () => [generalSettings()]});
