import {BluetoothBatteryReader} from '../monitoring/bluetoothBattery';
import {describe, expect, it, run} from './test-runner';

describe('Bluetooth battery sources and proxy lifetime', () => {
    it('uses the owning adapter, never an assumed hci0', () => {
        const paths: string[] = [];
        const reader = new BluetoothBatteryReader((path) => {
            paths.push(path);
            return {percentage: () => 42};
        });
        expect(reader.read({address: 'AA:BB:CC:DD:EE:FF', adapter: '/org/bluez/hci2'})).toBe(42);
        expect(paths).toEqual(['/org/bluez/hci2/dev_AA_BB_CC_DD_EE_FF']);
        expect(reader.read({address: 'AA:BB:CC:DD:EE:FF'})).toBeNull();
        expect(paths.length).toBe(1);
    });

    it('prefers native fractional readings, including zero, and rejects invalid values', () => {
        const reader = new BluetoothBatteryReader(() => { throw new Error('no proxy needed'); });
        expect(reader.read({batteryPercentage: 0.2})).toBe(20);
        expect(reader.read({battery_percentage: 0})).toBe(0);
        expect(reader.read({batteryPercentage: -1})).toBeNull();
        expect(reader.read({batteryPercentage: Number.NaN})).toBeNull();
        expect(reader.read({batteryPercentage: 2})).toBeNull();
    });

    it('reuses live cached properties and separates the same address on different adapters', () => {
        let percentage = 50;
        let created = 0;
        const reader = new BluetoothBatteryReader(() => {
            created++;
            return {percentage: () => percentage};
        });
        const a = {address: 'AA:BB:CC:DD:EE:FF', adapter: '/org/bluez/hci1'};
        expect(reader.read(a)).toBe(50);
        percentage = 30;
        expect(reader.read(a)).toBe(30);
        expect(created).toBe(1);
        reader.read({...a, adapter: '/org/bluez/hci2'});
        expect(created).toBe(2);
    });

    it('evicts removed-device proxies and recreates them if a device returns', () => {
        let created = 0;
        const reader = new BluetoothBatteryReader(() => {
            created++;
            return {percentage: () => 20};
        });
        const a = {address: 'AA:BB:CC:DD:EE:FF', adapter: '/org/bluez/hci1'};
        const b = {address: '11:22:33:44:55:66', adapter: '/org/bluez/hci1'};
        reader.read(a);
        reader.read(b);
        reader.retain([b]);
        reader.read(b);
        expect(created).toBe(2);
        reader.read(a);
        expect(created).toBe(3);
        reader.retain([]);
        reader.read(b);
        expect(created).toBe(4);
    });

    it('contains BlueZ errors and rejects impossible percentages', () => {
        const device = {address: 'AA:BB:CC:DD:EE:FF', adapter: '/org/bluez/hci1'};
        expect(new BluetoothBatteryReader(() => { throw new Error('offline'); }).read(device))
            .toBeNull();
        expect(new BluetoothBatteryReader(() => ({percentage: () => 101})).read(device)).toBeNull();
    });
});

await run();
