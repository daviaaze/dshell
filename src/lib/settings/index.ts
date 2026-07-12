import Gio from 'gi://Gio';
import {createSettings} from 'gnim-schemas';
import {createContext} from 'gnim';
import {barSchema, generalSchema, weatherSchema, timerSchema} from './schema';

// Constraint derived from gnim-schemas' own `createSettings` signature so we
// preserve full schema type inference (accessors + setters) without leaking an
// explicit `any` into the codebase.
type AnySchema = Parameters<typeof createSettings>[1];

// ── Helper: create a settings group from a schema ──

function createSettingsGroup<S extends AnySchema>(schema: S) {
    const settings = new Gio.Settings({schemaId: schema.id});
    return {
        raw: settings,
        ...createSettings(settings, schema),
    };
}

// ── App settings ──

function createAppSettings() {
    return {
        bar: createSettingsGroup(barSchema),
        general: createSettingsGroup(generalSchema),
        weather: createSettingsGroup(weatherSchema),
        timer: createSettingsGroup(timerSchema),
    };
}

type Settings = ReturnType<typeof createAppSettings>;

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider<T>(fn: () => T) {
    return SettingsContext.provide(createAppSettings(), fn);
}

export function useSettings() {
    const settings = SettingsContext.use();
    if (!settings) throw Error('settings not in scope');
    return settings;
}
