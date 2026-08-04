/**
 * Smoke test for BluetoothService — singleton identity and the
 * bindable isPowered property default before init().
 */
import BluetoothService from '../bluetooth/bluetoothService';
import {describe, expect, it, run} from './test-runner';

describe('BluetoothService', () => {
    it('returns the same singleton on repeated get_default()', () => {
        const a = BluetoothService.get_default();
        const b = BluetoothService.get_default();
        expect(a).toBe(b);
    });

    it('isPowered defaults to false before init()', () => {
        const s = BluetoothService.get_default();
        expect(s.isPowered).toBe(false);
    });
});

await run(import.meta.url);
