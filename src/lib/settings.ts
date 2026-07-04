import Gio from 'gi://Gio';
import {createSettings} from 'gnim-schemas';
import {createContext} from 'gnim';
import {barSchema, generalSchema, weatherSchema, timerSchema} from './gschema';

// ── Helper: create a settings group from a schema ──

function createSettingsGroup<T extends Gio.Settings>(schema: {id: string}) {
    const settings = new Gio.Settings({schemaId: schema.id}) as T;
    return {
        raw: settings,
        ...createSettings(settings, schema),
    };
}

type SettingsGroup<T extends Gio.Settings> = ReturnType<
    typeof createSettingsGroup<T>
>;

// ── App settings ──

function createAppSettings() {
    return {
        bar: createSettingsGroup<Gio.Settings>(barSchema),
        general: createSettingsGroup<Gio.Settings>(generalSchema),
        weather: createSettingsGroup<Gio.Settings>(weatherSchema),
        timer: createSettingsGroup<Gio.Settings>(timerSchema),
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
