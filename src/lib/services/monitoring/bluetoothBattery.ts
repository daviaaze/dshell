import Gio from 'gi://Gio?version=2.0';

const BLUEZ_BUS = 'org.bluez';
const BLUEZ_PREFIX = '/org/bluez/hci0/dev_';

function bluezPath(address: string): string {
    return BLUEZ_PREFIX + address.replace(/:/g, '_');
}

export function getBlueZBatteryPercentage(address: string): number | null {
    try {
        const proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            BLUEZ_BUS,
            bluezPath(address),
            'org.bluez.Battery1',
            null
        );
        const pct = proxy.get_cached_property('Percentage');
        if (pct) return pct.get_byte();
        return null;
    } catch {
        return null;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDeviceBatteryPercentage(device: any): number | null {
    if (device.battery_percentage >= 0) {
        return device.battery_percentage * 100;
    }
    return getBlueZBatteryPercentage(device.address);
}
