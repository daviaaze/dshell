import Gio from 'gi://Gio';
import {createSettings, Schema} from 'gnim/schema';
import {createContext} from 'gnim';
import {
    barSchema,
    generalSchema,
    weatherSchema,
    timerSchema,
    screenCaptureSchema,
} from './schema.gschema';

// ── Helper: create a settings group from a schema ──

function createSettingsGroup<S extends Schema>(schema: S) {
    const settings = new Gio.Settings({schemaId: schema.id});
    return {
        raw: settings,
        ...createSettings(settings, schema),
    };
}

// ── App settings ──

type Settings = ReturnType<typeof createAppSettings>;

const SettingsContext = createContext<Settings | null>(null);

export {SettingsContext};

export function createAppSettings() {
    return {
        bar: createSettingsGroup(barSchema),
        general: createSettingsGroup(generalSchema),
        weather: createSettingsGroup(weatherSchema),
        timer: createSettingsGroup(timerSchema),
        screenCapture: createSettingsGroup(screenCaptureSchema),
    };
}

export function SettingsProvider<T>(fn: () => T) {
    return SettingsContext.provide(createAppSettings(), fn);
}

export function useSettings() {
    const settings = SettingsContext.use();
    if (!settings) throw Error('settings not in scope');
    return settings;
}
