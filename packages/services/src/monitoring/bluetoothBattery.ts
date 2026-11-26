import Gio from 'gi://Gio?version=2.0';

const BLUEZ_BUS = 'org.bluez';
const DEFAULT_ADAPTER_PATH = '/org/bluez/hci0';

/**
 * Battery1 proxies by device path. A proxy keeps its cached properties current
 * from PropertiesChanged, so the render path does not create one per call.
 */
const proxies = new Map<string, Gio.DBusProxy>();

function bluezPath(address: string, adapterPath: string): string {
    return `${adapterPath}/dev_${address.replace(/:/g, '_')}`;
}

export function getBlueZBatteryPercentage(
    address: string,
    adapterPath = DEFAULT_ADAPTER_PATH
): number | null {
    try {
        const path = bluezPath(address, adapterPath);
        let proxy = proxies.get(path);
        if (!proxy) {
            proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.NONE,
                null,
                BLUEZ_BUS,
                path,
                'org.bluez.Battery1',
                null
            );
            proxies.set(path, proxy);
        }
        const pct = proxy.get_cached_property('Percentage');
        if (pct) return pct.get_byte();
        return null;
    } catch {
        return null;
    }
}

export function getDeviceBatteryPercentage(device: unknown): number | null {
    const d = device as {battery_percentage?: number; address?: string; adapter?: string};
    if (typeof d.battery_percentage === 'number' && d.battery_percentage >= 0) {
        return d.battery_percentage * 100;
    }
    return d.address ? getBlueZBatteryPercentage(d.address, d.adapter) : null;
}
