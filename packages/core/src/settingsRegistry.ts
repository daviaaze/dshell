import Gio from 'gi://Gio';
import {createSettings, Schema} from 'gnim/schema';

/**
 * Settings registry — schemas self-declare via `defineSettings()` and the
 * shell instantiates all groups at boot via `initSettingsRoot()`.
 *
 * Each service/widget declares its own settings schema next to its code:
 *
 *   // packages/services/src/location/weather.gschema.ts
 *   export const weatherSettings = defineSettings('weather', s => s
 *       .key('latitude', 'd', {default: 0, summary: '…'})
 *   );
 *
 * `defineSettings` returns a lazy accessor. It throws if called before
 * `initSettingsRoot()` runs — so module code can capture the accessor at
 * import time but may only call it during/after boot.
 *
 * Schema id/path follow the app convention (`<domain>.<name>`, `/<domain>/<name>/`),
 * so owners declare only their keys.
 *
 * The build-time schema list derives from this registry:
 *   export default defineSchemaList(getRegisteredSchemas());
 */

const baseId: string = import.meta.domain || '@domain@';
const basePath = `/${baseId.replaceAll('.', '/')}/`;

function createSettingsGroup<S extends Schema>(schema: S) {
    const settings = new Gio.Settings({schemaId: schema.id});
    return {raw: settings, ...createSettings(settings, schema)};
}

export type SettingsGroup<S extends Schema> = ReturnType<
    typeof createSettingsGroup<S>
>;

const schemas = new Map<string, Schema>();
const groups = new Map<string, unknown>();

/**
 * Declare a settings schema under `name` and get a typed lazy accessor
 * for its settings group.
 */
export function defineSettings<S extends Schema>(
    name: string,
    build: (schema: Schema) => S
): () => SettingsGroup<S> {
    if (schemas.has(name)) {
        throw new Error(`settings '${name}' already defined`);
    }
    const schema = build(
        new Schema({id: `${baseId}.${name}`, path: `${basePath}${name}/`})
    );
    schemas.set(name, schema);
    return () => {
        const group = groups.get(name);
        if (!group) {
            throw new Error(
                `settings '${name}' accessed before initSettingsRoot()`
            );
        }
        return group as SettingsGroup<S>;
    };
}

/** All declared schemas, in declaration order (for defineSchemaList). */
export function getRegisteredSchemas(): Schema[] {
    return [...schemas.values()];
}

/** A single declared schema by name (for per-file gnim schemas export). */
export function getRegisteredSchema(name: string): Schema {
    const schema = schemas.get(name);
    if (!schema) {
        throw new Error(`schema '${name}' not registered`);
    }
    return schema;
}

/**
 * Instantiate every declared settings group. Must run once at boot before
 * any accessor is called. `factory` is injectable for tests.
 */
export function initSettingsRoot(
    factory: (schema: Schema) => unknown = s => createSettingsGroup(s)
): void {
    for (const [name, schema] of schemas) {
        if (!groups.has(name)) groups.set(name, factory(schema));
    }
}

/** Clear all declarations and instances (test isolation). */
export function resetSettingsRegistry(): void {
    schemas.clear();
    groups.clear();
}
