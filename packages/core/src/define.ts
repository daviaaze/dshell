import type Adw from 'gi://Adw?version=1';
import type {GnimNode} from 'gnim';
import type ServiceRegistry from './serviceRegistry';
import type {Service} from './serviceRegistry';
import logger, {perf} from './logger';

/**
 * Self-registration layer for services and widgets.
 *
 * Modules declare themselves at import time; the composition root boots
 * the app from the collected declarations:
 *
 *   // weather.ts (module bottom)
 *   defineService({
 *       name: 'Weather',
 *       service: Weather.get_default(),
 *       initArgs: () => [weatherSettings()],
 *   });
 *
 *   // bar/widget.ts
 *   defineWidget({name: 'bar', mount: bar});
 *
 * The import graph is the dependency tree: importing a widget pulls in the
 * service modules it uses, which self-register as a side effect. Shared
 * services dedupe via ES module caching.
 *
 * Boot order: declarations (import phase) → `initServices(ctx)` resolves
 * initArgs factories against ctx and drives the ServiceRegistry → widgets
 * mount (handled by the composition root, which owns render()).
 */

export interface AppContext {
    app: Adw.Application;
    registry: ServiceRegistry;
}

export interface ServiceSpec {
    name: string;
    service: Service;
    dependsOn?: string[];
    order?: number;
    /** Resolved lazily at boot against the AppContext. */
    initArgs?: (ctx: AppContext) => unknown[];
    critical?: boolean;
}

export interface WidgetActions {
    onToggleSettings: () => void;
    onToggleWindowSwitcher: () => void;
}

export interface WidgetDef {
    name: string;
    /** Widget component; mounted inside the composition root's render(). */
    mount: () => GnimNode;
    actions?: Partial<WidgetActions>;
    /** Lazy widgets are declared but not mounted at boot (e.g. settings). */
    lazy?: boolean;
}

const serviceSpecs = new Map<string, ServiceSpec>();
const widgetDefs: WidgetDef[] = [];

/** Declare a service. Throws on duplicate name (collision is a bug). */
export function defineService(spec: ServiceSpec): void {
    if (serviceSpecs.has(spec.name)) {
        throw new Error(`service '${spec.name}' already defined`);
    }
    serviceSpecs.set(spec.name, spec);
}

/** Declare a widget. Re-declaring a name replaces the previous def. */
export function defineWidget(def: WidgetDef): void {
    const i = widgetDefs.findIndex(w => w.name === def.name);
    if (i >= 0) widgetDefs[i] = def;
    else widgetDefs.push(def);
}

/** All widget declarations, in declaration order. */
export function getWidgetDefs(): readonly WidgetDef[] {
    return widgetDefs;
}

/** Widget actions merged across declarations (later wins per key). */
export function getWidgetActions(): Partial<WidgetActions> {
    const actions: Partial<WidgetActions> = {};
    for (const def of widgetDefs) {
        if (def.actions) Object.assign(actions, def.actions);
    }
    return actions;
}

/**
 * Register every declared service into ctx.registry (resolving initArgs
 * factories) and initialize them in dependency order.
 */
export function initServices(ctx: AppContext): boolean {
    perf.start('services-init', 'mount');
    for (const spec of serviceSpecs.values()) {
        ctx.registry.register({
            name: spec.name,
            service: spec.service,
            dependsOn: spec.dependsOn,
            order: spec.order,
            initArgs: spec.initArgs?.(ctx),
            critical: spec.critical,
        });
    }
    const ok = ctx.registry.initAll();
    if (!ok) {
        logger.error('mount', 'Some services failed to init — continuing');
    }
    perf.stop('services-init', 'mount');
    return ok;
}

/** Clear all declarations (test isolation). */
export function resetDefineRegistry(): void {
    serviceSpecs.clear();
    widgetDefs.length = 0;
}
