import {
    buildAlertNotification,
    createBatteryState,
    createBluetoothState,
    createTemperatureState,
    decideBatteryAlerts,
    decideBluetoothAlerts,
    decideTemperatureAlert,
    temperatureCelsius,
    type BatterySample,
    type BluetoothSample,
    type SystemAlert,
} from '../notifications/alerts';
import {describe, expect, it, run} from './test-runner';

const battery = (percentage: number, discharging = true): BatterySample => ({
    percentage,
    discharging,
    present: true,
    plugged: !discharging,
});
const device = (id: string, connected = true, percentage: number | null = 80): BluetoothSample => ({
    id,
    name: 'Fones',
    connected,
    percentage,
});
const kinds = (alerts: SystemAlert[]) => alerts.map((alert) => alert.kind);

describe('battery alert decisions', () => {
    it('does not alert on the first sample, including a critically low startup', () => {
        const first = decideBatteryAlerts(createBatteryState(), battery(8), 0);
        expect(first.alerts).toEqual([]);
        expect(decideBatteryAlerts(first.state, battery(7), 60000).alerts).toEqual([]);
    });

    it('posts one low and one critical alert per discharge, sharing the replacement key', () => {
        let state = decideBatteryAlerts(createBatteryState(), battery(40), 0).state;
        const low = decideBatteryAlerts(state, battery(20), 1000);
        expect(kinds(low.alerts)).toEqual(['battery-low']);
        expect(decideBatteryAlerts(low.state, battery(19), 120000).alerts).toEqual([]);
        const critical = decideBatteryAlerts(low.state, battery(10), 2000);
        expect(kinds(critical.alerts)).toEqual(['battery-critical']);
        expect(critical.alerts[0].key).toBe(low.alerts[0].key);
        state = decideBatteryAlerts(critical.state, battery(9), 300000).state;
        expect(decideBatteryAlerts(state, battery(12), 600000).alerts).toEqual([]);
    });

    it('escalates directly to critical without also emitting low', () => {
        const first = decideBatteryAlerts(createBatteryState(), battery(50), 0);
        expect(kinds(decideBatteryAlerts(first.state, battery(9), 1000).alerts)).toEqual([
            'battery-critical',
        ]);
    });

    it('never warns while charging, absent, or with invalid readings', () => {
        const first = decideBatteryAlerts(createBatteryState(), battery(50, false), 0);
        expect(decideBatteryAlerts(first.state, battery(8, false), 1000).alerts).toEqual([]);
        const onBattery = decideBatteryAlerts(createBatteryState(), battery(50), 0);
        expect(decideBatteryAlerts(onBattery.state, {...battery(8), present: false}, 1000).alerts)
            .toEqual([]);
        expect(decideBatteryAlerts(onBattery.state, battery(Number.NaN), 1000).alerts).toEqual([]);
    });

    it('still reports a charger change when the battery reading is absent or invalid', () => {
        const plugged = decideBatteryAlerts(createBatteryState(), battery(50, false), 0);
        const unplugged = decideBatteryAlerts(plugged.state,
            {...battery(Number.NaN), present: false}, 1000);
        expect(kinds(unplugged.alerts)).toEqual(['power-unplug']);
    });

    it('requires five percentage points of recovery before rearming', () => {
        let state = decideBatteryAlerts(createBatteryState(), battery(50), 0).state;
        state = decideBatteryAlerts(state, battery(20), 1000).state;
        state = decideBatteryAlerts(state, battery(24), 61000).state;
        expect(decideBatteryAlerts(state, battery(20), 62000).alerts).toEqual([]);
        state = decideBatteryAlerts(state, battery(25), 63000).state;
        expect(kinds(decideBatteryAlerts(state, battery(20), 64000).alerts)).toEqual(['battery-low']);
    });

    it('applies a cooldown after rearming but does not delay a critical escalation', () => {
        let state = decideBatteryAlerts(createBatteryState(), battery(50), 0).state;
        state = decideBatteryAlerts(state, battery(20), 1000).state;
        state = decideBatteryAlerts(state, battery(25), 2000).state;
        expect(decideBatteryAlerts(state, battery(20), 3000).alerts).toEqual([]);
        const pending = decideBatteryAlerts(state, battery(20), 3000);
        expect(kinds(decideBatteryAlerts(pending.state, battery(20), 61000).alerts)).toEqual([
            'battery-low',
        ]);
        expect(kinds(decideBatteryAlerts(pending.state, battery(9), 4000).alerts)).toEqual([
            'battery-critical',
        ]);
    });

    it('rearms critical only at fifteen percent without downgrading it to a low alert', () => {
        let state = decideBatteryAlerts(createBatteryState(), battery(50), 0).state;
        state = decideBatteryAlerts(state, battery(10), 1000).state;
        state = decideBatteryAlerts(state, battery(14), 61000).state;
        expect(decideBatteryAlerts(state, battery(10), 62000).alerts).toEqual([]);
        state = decideBatteryAlerts(state, battery(15), 63000).state;
        expect(decideBatteryAlerts(state, battery(18), 64000).alerts).toEqual([]);
        expect(kinds(decideBatteryAlerts(state, battery(10), 65000).alerts))
            .toEqual(['battery-critical']);
    });

    it('reports charger transitions without an initial plug sound or notification', () => {
        let state = decideBatteryAlerts(createBatteryState(), battery(50), 0).state;
        const plugged = decideBatteryAlerts(state, battery(50, false), 1000);
        expect(kinds(plugged.alerts)).toEqual(['power-plug']);
        state = plugged.state;
        expect(decideBatteryAlerts(state, battery(51, false), 2000).alerts).toEqual([]);
        expect(kinds(decideBatteryAlerts(state, battery(51), 3000).alerts)).toEqual(['power-unplug']);
    });

    it('honors configured thresholds and keeps critical below low', () => {
        const first = decideBatteryAlerts(createBatteryState(), battery(50), 0, {low: 30, critical: 15});
        expect(kinds(decideBatteryAlerts(first.state, battery(30), 1000, {low: 30, critical: 15}).alerts))
            .toEqual(['battery-low']);
        expect(kinds(decideBatteryAlerts(first.state, battery(19), 1000, {low: 20, critical: 30}).alerts))
            .toEqual(['battery-critical']);
    });
});

describe('local temperature alert decisions', () => {
    it('converts systemUsage fractions to real Celsius and ignores unavailable readings', () => {
        expect(temperatureCelsius(0.8, true)).toBe(80);
        expect(temperatureCelsius(0.95, true)).toBe(95);
        expect(temperatureCelsius(0.9, false)).toBeNull();
        expect(temperatureCelsius(Number.NaN, true)).toBeNull();
        expect(decideTemperatureAlert(createTemperatureState(), null, 0).alert).toBeNull();
    });

    it('warns once while hot, even beyond the cooldown, and escalates immediately', () => {
        const warning = decideTemperatureAlert(createTemperatureState(), 80, 0);
        expect(warning.alert?.kind).toBe('temperature-warning');
        expect(decideTemperatureAlert(warning.state, 85, 600000).alert).toBeNull();
        const critical = decideTemperatureAlert(warning.state, 90, 1000);
        expect(critical.alert?.kind).toBe('temperature-critical');
        expect(critical.alert?.key).toBe(warning.alert?.key);
        expect(decideTemperatureAlert(critical.state, 82, 600000).alert).toBeNull();
    });

    it('requires five degrees of cooling and a cooldown before a new warning', () => {
        let state = decideTemperatureAlert(createTemperatureState(), 80, 0).state;
        state = decideTemperatureAlert(state, 76, 1000).state;
        expect(decideTemperatureAlert(state, 80, 301000).alert).toBeNull();
        state = decideTemperatureAlert(state, 75, 2000).state;
        const pending = decideTemperatureAlert(state, 80, 3000);
        expect(pending.alert).toBeNull();
        expect(decideTemperatureAlert(pending.state, 80, 300000).alert?.kind)
            .toBe('temperature-warning');
    });

    it('keeps hysteresis across sensor outages and honors custom thresholds', () => {
        const warning = decideTemperatureAlert(createTemperatureState(), 70, 0, {warning: 70, critical: 85});
        const missing = decideTemperatureAlert(warning.state, null, 300000);
        expect(decideTemperatureAlert(missing.state, 80, 600000, {warning: 70, critical: 85}).alert)
            .toBeNull();
    });

    it('rearms critical only after cooling and keeps its own cooldown', () => {
        let state = decideTemperatureAlert(createTemperatureState(), 90, 0).state;
        state = decideTemperatureAlert(state, 86, 1000).state;
        expect(decideTemperatureAlert(state, 90, 301000).alert).toBeNull();
        state = decideTemperatureAlert(state, 85, 2000).state;
        const pending = decideTemperatureAlert(state, 90, 3000);
        expect(pending.alert).toBeNull();
        expect(decideTemperatureAlert(pending.state, 90, 300000).alert?.kind)
            .toBe('temperature-critical');
    });
});

describe('Bluetooth alert decisions', () => {
    it('does not announce existing devices or low batteries during startup', () => {
        const first = decideBluetoothAlerts(createBluetoothState(), [device('a', true, 10)], 0);
        expect(first.alerts).toEqual([]);
        expect(decideBluetoothAlerts(first.state, [device('a', true, 9)], 10000).alerts).toEqual([]);
    });

    it('debounces stable connect/disconnect transitions and cancels reconnect bursts', () => {
        let state = decideBluetoothAlerts(createBluetoothState(), [device('a', false)], 0).state;
        state = decideBluetoothAlerts(state, [device('a')], 100).state;
        expect(decideBluetoothAlerts(state, [device('a')], 1099).alerts).toEqual([]);
        const connected = decideBluetoothAlerts(state, [device('a')], 1100);
        expect(kinds(connected.alerts)).toEqual(['bluetooth-connected']);
        state = decideBluetoothAlerts(connected.state, [device('a', false)], 1200).state;
        state = decideBluetoothAlerts(state, [device('a')], 1500).state;
        expect(decideBluetoothAlerts(state, [device('a')], 5000).alerts).toEqual([]);
        state = decideBluetoothAlerts(state, [device('a', false)], 6000).state;
        expect(kinds(decideBluetoothAlerts(state, [device('a', false)], 7000).alerts))
            .toEqual(['bluetooth-disconnected']);
    });

    it('tracks devices independently and handles a device disappearing once', () => {
        let state = decideBluetoothAlerts(createBluetoothState(), [device('a'), device('b')], 0).state;
        state = decideBluetoothAlerts(state, [device('b')], 100).state;
        const removed = decideBluetoothAlerts(state, [device('b')], 1100);
        expect(kinds(removed.alerts)).toEqual(['bluetooth-disconnected']);
        expect(removed.alerts[0].key.includes('a')).toBe(true);
        expect(decideBluetoothAlerts(removed.state, [device('b')], 5000).alerts).toEqual([]);
    });

    it('announces a newly discovered connected device after debounce, not on discovery', () => {
        const first = decideBluetoothAlerts(createBluetoothState(), [], 0);
        const pending = decideBluetoothAlerts(first.state, [device('a')], 100);
        expect(pending.alerts).toEqual([]);
        expect(kinds(decideBluetoothAlerts(pending.state, [device('a')], 1100).alerts))
            .toEqual(['bluetooth-connected']);
    });

    it('deduplicates low battery per device, rearms at +5, and does not repeat on reconnect', () => {
        let state = decideBluetoothAlerts(createBluetoothState(), [device('a'), device('b')], 0).state;
        const low = decideBluetoothAlerts(state, [device('a', true, 20), device('b', true, 20)], 1000);
        expect(kinds(low.alerts)).toEqual(['bluetooth-battery-low', 'bluetooth-battery-low']);
        expect(low.alerts[0].key === low.alerts[1].key).toBe(false);
        state = decideBluetoothAlerts(low.state, [device('a', false, 20), device('b', true, 20)], 2000).state;
        state = decideBluetoothAlerts(state, [device('a', true, 20), device('b', true, 20)], 2500).state;
        expect(decideBluetoothAlerts(state, [device('a', true, 20), device('b', true, 20)], 10000).alerts)
            .toEqual([]);
        state = decideBluetoothAlerts(state, [device('a', true, 25), device('b', true, 20)], 61000).state;
        expect(kinds(decideBluetoothAlerts(state, [device('a', true, 20), device('b', true, 20)], 62000).alerts))
            .toEqual(['bluetooth-battery-low']);
    });

    it('honors a per-device threshold, battery cooldown and unknown readings', () => {
        const config = {low: 30};
        let state = decideBluetoothAlerts(createBluetoothState(), [device('a')], 0, config).state;
        state = decideBluetoothAlerts(state, [device('a', true, 30)], 1000, config).state;
        state = decideBluetoothAlerts(state, [device('a', true, 35)], 2000, config).state;
        state = decideBluetoothAlerts(state, [device('a', true, null)], 2500, config).state;
        const pending = decideBluetoothAlerts(state, [device('a', true, 30)], 3000, config);
        expect(pending.alerts).toEqual([]);
        expect(kinds(decideBluetoothAlerts(pending.state, [device('a', true, 30)], 61000, config).alerts))
            .toEqual(['bluetooth-battery-low']);
    });
});

describe('desktop alert content', () => {
    it('uses critical urgency, symbolic icons, stable keys and pt-BR text', () => {
        for (const kind of ['battery-critical', 'temperature-critical'] as const) {
            const content = buildAlertNotification({key: 'local', kind, percentage: 10, temperatureC: 90});
            expect(content.urgency).toBe(2);
            expect(content.icon.endsWith('-symbolic')).toBe(true);
        }
        expect(buildAlertNotification({key: 'battery', kind: 'battery-low', percentage: 20}).body)
            .toBe('Restam 20% de bateria. Conecte o carregador.');
    });

    it('never exposes MACs, markup or unbounded device names and keeps names in the body', () => {
        const alert: SystemAlert = {
            key: '/org/bluez/hci1/dev_AA_BB_CC_DD_EE_FF',
            kind: 'bluetooth-connected',
            deviceName: `<b>Fones</b> AA:BB:CC:DD:EE:FF ${'x'.repeat(500)}`,
        };
        const content = buildAlertNotification(alert);
        expect(content.summary).toBe('Dispositivo Bluetooth conectado');
        expect(content.body.includes('AA:BB:CC:DD:EE:FF')).toBe(false);
        expect(content.body.includes('<')).toBe(false);
        expect(content.body.length < 160).toBe(true);
        const redacted = buildAlertNotification(alert, false);
        expect(redacted.body.includes('Fones')).toBe(false);
        expect(redacted.body).toBe('Um dispositivo Bluetooth foi conectado.');
    });

    it('redacts names for all Bluetooth alert kinds and removes alternate MAC spellings', () => {
        for (const kind of ['bluetooth-connected', 'bluetooth-disconnected', 'bluetooth-battery-low'] as const) {
            const alert = {key: 'private', kind, percentage: 20,
                deviceName: 'Fones dev_AA_BB_CC_DD_EE_FF AABBCCDDEEFF'};
            const visible = buildAlertNotification(alert);
            expect(visible.summary.includes('Fones')).toBe(false);
            expect(visible.body.includes('AA_BB_CC_DD_EE_FF')).toBe(false);
            expect(visible.body.includes('AABBCCDDEEFF')).toBe(false);
            expect(buildAlertNotification(alert, false).body.includes('Fones')).toBe(false);
        }
    });
});

await run();
