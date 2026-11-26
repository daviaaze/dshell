export type AlertKind =
    | 'battery-low'
    | 'battery-critical'
    | 'power-plug'
    | 'power-unplug'
    | 'temperature-warning'
    | 'temperature-critical'
    | 'bluetooth-connected'
    | 'bluetooth-disconnected'
    | 'bluetooth-battery-low';

export interface SystemAlert {
    key: string;
    kind: AlertKind;
    percentage?: number;
    temperatureC?: number;
    deviceName?: string;
}

export interface AlertNotification {
    summary: string;
    body: string;
    icon: string;
    urgency: 1 | 2;
}

export interface BatterySample {
    percentage: number;
    present: boolean;
    discharging: boolean;
    plugged: boolean | null;
}

export interface BatteryState {
    initialized: boolean;
    plugged: boolean | null;
    lowArmed: boolean;
    criticalArmed: boolean;
    lastLowAt: number;
    lastCriticalAt: number;
}

export function createBatteryState(): BatteryState {
    return {
        initialized: false,
        plugged: null,
        lowArmed: true,
        criticalArmed: true,
        lastLowAt: -Infinity,
        lastCriticalAt: -Infinity,
    };
}

/** Percentages are 0..100. Charging alone does not rearm an exhausted threshold. */
export function decideBatteryAlerts(
    previous: BatteryState,
    sample: BatterySample,
    now: number,
    config: {low?: number; critical?: number; cooldownMs?: number} = {}
): {state: BatteryState; alerts: SystemAlert[]} {
    const low = Math.max(10, Math.min(50, config.low ?? 20));
    const critical = Math.max(1, Math.min(low - 1, config.critical ?? 10));
    const cooldown = config.cooldownMs ?? 60000;
    const state = {...previous};
    const alerts: SystemAlert[] = [];
    if (sample.plugged !== null) {
        if (previous.plugged !== null && previous.plugged !== sample.plugged) {
            alerts.push({key: 'power', kind: sample.plugged ? 'power-plug' : 'power-unplug'});
        }
        state.plugged = sample.plugged;
    }
    const percentage = sample.percentage;
    if (!sample.present) {
        return {state: {...createBatteryState(), plugged: state.plugged}, alerts};
    }
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        return {state, alerts};
    }
    if (!state.initialized) {
        state.initialized = true;
        state.lowArmed = percentage > low;
        state.criticalArmed = percentage > critical;
        return {state, alerts};
    }
    if (percentage >= low + 5) state.lowArmed = true;
    if (percentage >= critical + 5) state.criticalArmed = true;
    if (!sample.discharging) return {state, alerts};
    if (percentage <= critical) {
        if (state.criticalArmed && now - state.lastCriticalAt >= cooldown) {
            alerts.push({key: 'battery', kind: 'battery-critical', percentage});
            state.criticalArmed = false;
            state.lowArmed = false;
            state.lastCriticalAt = now;
        }
    } else if (percentage <= low && state.lowArmed && now - state.lastLowAt >= cooldown) {
        alerts.push({key: 'battery', kind: 'battery-low', percentage});
        state.lowArmed = false;
        state.lastLowAt = now;
    }
    return {state, alerts};
}

export interface TemperatureState {
    warningArmed: boolean;
    criticalArmed: boolean;
    lastWarningAt: number;
    lastCriticalAt: number;
}

export function createTemperatureState(): TemperatureState {
    return {warningArmed: true, criticalArmed: true, lastWarningAt: -Infinity, lastCriticalAt: -Infinity};
}

/** SystemUsage's local sensor is millidegrees / 100000, not degrees Celsius. */
export function temperatureCelsius(level: number, available: boolean): number | null {
    return available && Number.isFinite(level) && level >= -0.5 && level <= 2 ? level * 100 : null;
}

export function decideTemperatureAlert(
    previous: TemperatureState,
    celsius: number | null,
    now: number,
    config: {warning?: number; critical?: number; cooldownMs?: number} = {}
): {state: TemperatureState; alert: SystemAlert | null} {
    const state = {...previous};
    if (celsius === null || !Number.isFinite(celsius) || celsius < -50 || celsius > 200) {
        return {state, alert: null};
    }
    const warning = Math.max(50, Math.min(110, config.warning ?? 80));
    const critical = Math.max(warning + 1, Math.min(120, config.critical ?? 90));
    const cooldown = config.cooldownMs ?? 300000;
    if (celsius <= warning - 5) state.warningArmed = true;
    if (celsius <= critical - 5) state.criticalArmed = true;
    if (celsius >= critical) {
        if (state.criticalArmed && now - state.lastCriticalAt >= cooldown) {
            state.criticalArmed = false;
            state.warningArmed = false;
            state.lastCriticalAt = now;
            return {state, alert: {key: 'temperature', kind: 'temperature-critical', temperatureC: celsius}};
        }
    } else if (celsius >= warning && state.warningArmed && now - state.lastWarningAt >= cooldown) {
        state.warningArmed = false;
        state.lastWarningAt = now;
        return {state, alert: {key: 'temperature', kind: 'temperature-warning', temperatureC: celsius}};
    }
    return {state, alert: null};
}

export interface BluetoothSample {
    /** Adapter + address identity, used internally only; never placed in notification content. */
    id: string;
    name: string;
    connected: boolean;
    percentage: number | null;
}

interface BluetoothDeviceState {
    name: string;
    connected: boolean;
    pending: boolean;
    pendingSince: number;
    lastSeenAt: number;
    batteryArmed: boolean;
    lastBatteryAt: number;
}

export interface BluetoothState {
    initialized: boolean;
    devices: Map<string, BluetoothDeviceState>;
}

export function createBluetoothState(): BluetoothState {
    return {initialized: false, devices: new Map()};
}

/** A stable one-second transition is one event; a fast drop/reconnect is no event. */
export function decideBluetoothAlerts(
    previous: BluetoothState,
    samples: BluetoothSample[],
    now: number,
    config: {low?: number; debounceMs?: number; cooldownMs?: number} = {}
): {state: BluetoothState; alerts: SystemAlert[]} {
    const low = Math.max(5, Math.min(50, config.low ?? 20));
    const debounce = config.debounceMs ?? 1000;
    const cooldown = config.cooldownMs ?? 60000;
    const incoming = new Map(samples.map((sample) => [sample.id, sample]));
    const devices = new Map<string, BluetoothDeviceState>();
    const alerts: SystemAlert[] = [];
    for (const id of new Set([...previous.devices.keys(), ...incoming.keys()])) {
        const sample = incoming.get(id);
        const old = previous.devices.get(id);
        if (!sample && !old) continue;
        // Retain a bounded reconnect memory, but not the device's D-Bus proxy.
        if (!sample && old && !old.connected && now - old.lastSeenAt > 1800000) continue;
        const connected = sample?.connected ?? false;
        const percentage = sample?.percentage;
        const validBattery = typeof percentage === 'number' && Number.isFinite(percentage)
            && percentage >= 0 && percentage <= 100;
        const state: BluetoothDeviceState = old ? {...old} : {
            name: sample?.name ?? '',
            connected: previous.initialized ? false : connected,
            pending: connected,
            pendingSince: now,
            lastSeenAt: now,
            batteryArmed: previous.initialized || !validBattery || percentage > low,
            lastBatteryAt: -Infinity,
        };
        if (sample) {
            state.name = sample.name;
            state.lastSeenAt = now;
        }
        if (connected !== state.pending) {
            state.pending = connected;
            state.pendingSince = now;
        }
        if (connected !== state.connected && now - state.pendingSince >= debounce) {
            state.connected = connected;
            alerts.push({
                key: `bluetooth-connection:${id}`,
                kind: connected ? 'bluetooth-connected' : 'bluetooth-disconnected',
                deviceName: state.name,
            });
        }
        if (validBattery && percentage >= low + 5) state.batteryArmed = true;
        if (connected && state.connected && validBattery && percentage <= low
            && state.batteryArmed && now - state.lastBatteryAt >= cooldown) {
            alerts.push({key: `bluetooth-battery:${id}`, kind: 'bluetooth-battery-low',
                deviceName: state.name, percentage});
            state.batteryArmed = false;
            state.lastBatteryAt = now;
        }
        devices.set(id, state);
    }
    return {state: {initialized: true, devices}, alerts};
}

/** Plain, bounded text: BlueZ aliases can be markup, MACs, or arbitrarily long. */
export function buildAlertNotification(alert: SystemAlert, revealDeviceName = true): AlertNotification {
    const name = revealDeviceName ? (alert.deviceName ?? '')
        .replace(/(?:[0-9a-f]{2}[:_-]){5}[0-9a-f]{2}|\b[0-9a-f]{12}\b/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/[<>&\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const percentage = Math.round(Math.max(0, Math.min(100, alert.percentage ?? 0)));
    const temperature = Math.round(alert.temperatureC ?? 0);
    switch (alert.kind) {
        case 'battery-low':
            return {summary: 'Bateria baixa', body: `Restam ${percentage}% de bateria. Conecte o carregador.`,
                icon: 'battery-low-symbolic', urgency: 1};
        case 'battery-critical':
            return {summary: 'Bateria em nível crítico', body: `Restam ${percentage}% de bateria. Conecte o carregador agora.`,
                icon: 'battery-caution-symbolic', urgency: 2};
        case 'power-plug':
            return {summary: 'Carregador conectado', body: 'O computador está ligado à energia.',
                icon: 'battery-ac-adapter-symbolic', urgency: 1};
        case 'power-unplug':
            return {summary: 'Carregador desconectado', body: 'O computador está usando a bateria.',
                icon: 'battery-symbolic', urgency: 1};
        case 'temperature-warning':
            return {summary: 'Temperatura elevada', body: `O sensor local está em ${temperature} °C. Verifique a ventilação.`,
                icon: 'dialog-warning-symbolic', urgency: 1};
        case 'temperature-critical':
            return {summary: 'Temperatura crítica', body: `O sensor local está em ${temperature} °C. Reduza a carga e verifique a ventilação.`,
                icon: 'dialog-error-symbolic', urgency: 2};
        case 'bluetooth-connected':
            return {summary: 'Dispositivo Bluetooth conectado',
                body: name ? `${name} foi conectado.` : 'Um dispositivo Bluetooth foi conectado.',
                icon: 'bluetooth-active-symbolic', urgency: 1};
        case 'bluetooth-disconnected':
            return {summary: 'Dispositivo Bluetooth desconectado',
                body: name ? `${name} foi desconectado.` : 'Um dispositivo Bluetooth foi desconectado.',
                icon: 'bluetooth-disconnected-symbolic', urgency: 1};
        case 'bluetooth-battery-low':
            return {summary: 'Bateria do dispositivo baixa',
                body: name ? `${name} está com ${percentage}% de bateria.` : `Um dispositivo Bluetooth está com ${percentage}% de bateria.`,
                icon: 'battery-low-symbolic', urgency: 1};
    }
}
