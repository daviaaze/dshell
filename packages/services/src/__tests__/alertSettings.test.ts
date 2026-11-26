import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import '@shade/core/settings/general.gschema';
import {getRegisteredSchema} from '@shade/core/settingsRegistry';
import {describe, expect, it, run} from './test-runner';

// scripts/test.sh compiles the current schema into an isolated, memory-backed source.
const schema = Gio.SettingsSchemaSource.get_default()!.lookup(getRegisteredSchema('general').id, true)!;

describe('system alert settings defaults and ranges', () => {
    it('enables each visual family and interaction sound except opt-in volume feedback', () => {
        for (const name of [
            'alert-battery-enabled', 'alert-power-enabled', 'alert-temperature-enabled',
            'alert-bluetooth-enabled', 'alert-bluetooth-battery-enabled',
            'sound-alert-power', 'sound-alert-bluetooth', 'sound-alert-temperature',
        ]) {
            expect(schema.get_key(name).get_default_value().get_boolean()).toBe(true);
        }
        expect(schema.get_key('sound-alert-volume').get_default_value().get_boolean()).toBe(false);
    });

    it('declares percent/Celsius defaults and rejects values outside every threshold range', () => {
        const thresholds = [
            ['alert-battery-low-threshold', 20, 10, 50],
            ['alert-battery-critical-threshold', 10, 1, 20],
            ['alert-temperature-warning-threshold', 80, 50, 110],
            ['alert-temperature-critical-threshold', 90, 60, 120],
            ['alert-bluetooth-battery-threshold', 20, 5, 50],
        ] as const;
        for (const [name, value, min, max] of thresholds) {
            const key = schema.get_key(name);
            expect(key.get_default_value().get_int32()).toBe(value);
            expect(key.range_check(new GLib.Variant('i', min))).toBe(true);
            expect(key.range_check(new GLib.Variant('i', max))).toBe(true);
            expect(key.range_check(new GLib.Variant('i', min - 1))).toBe(false);
            expect(key.range_check(new GLib.Variant('i', max + 1))).toBe(false);
        }
    });
});

await run();
