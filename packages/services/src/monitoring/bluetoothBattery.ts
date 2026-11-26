import Gio from 'gi://Gio?version=2.0';

interface BatteryDevice {
    batteryPercentage?: number;
    battery_percentage?: number;
    address?: string;
    adapter?: string;
}

interface BatteryProxy {
    percentage(): number | null;
}

/** One cached Battery1 proxy per adapter/device, owned only while the device exists. */
export class BluetoothBatteryReader {
    #proxies = new Map<string, BatteryProxy>();

    constructor(private readonly createProxy: (path: string) => BatteryProxy) {}

    read(device: unknown): number | null {
        if (!device || typeof device !== 'object') return null;
        const d = device as BatteryDevice;
        const native = d.batteryPercentage ?? d.battery_percentage;
        if (typeof native === 'number' && Number.isFinite(native) && native >= 0 && native <= 1) {
            return native * 100;
        }
        const path = this.#path(d);
        if (!path) return null;
        try {
            let proxy = this.#proxies.get(path);
            if (!proxy) {
                proxy = this.createProxy(path);
                this.#proxies.set(path, proxy);
            }
            const percentage = proxy.percentage();
            return percentage !== null && Number.isFinite(percentage)
                && percentage >= 0 && percentage <= 100 ? percentage : null;
        } catch {
            return null;
        }
    }

    retain(devices: readonly unknown[]): void {
        const current = new Set(devices.map((device) =>
            device && typeof device === 'object' ? this.#path(device as BatteryDevice) : null
        ));
        for (const path of this.#proxies.keys()) {
            if (!current.has(path)) this.#proxies.delete(path);
        }
    }

    #path(device: BatteryDevice): string | null {
        if (!device.adapter || !/^\/org\/bluez\/hci\d+$/.test(device.adapter)
            || !device.address || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.address)) {
            return null;
        }
        return `${device.adapter}/dev_${device.address.replaceAll(':', '_')}`;
    }
}

const reader = new BluetoothBatteryReader((path) => {
    const proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        'org.bluez',
        path,
        'org.bluez.Battery1',
        null
    );
    return {percentage: () => proxy.get_cached_property('Percentage')?.get_byte() ?? null};
});

export function getDeviceBatteryPercentage(device: unknown): number | null {
    return reader.read(device);
}

export function retainBluetoothBatteryDevices(devices: readonly unknown[]): void {
    reader.retain(devices);
}
