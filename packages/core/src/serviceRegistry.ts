import logger, {perf} from './logger';

/**
 * Minimal lifecycle interface for shell services.
 *
 * Services implement `init()` and optionally `dispose()`.
 * No abstract class dependency — GObject-based services implement
 * these methods alongside their GObject pattern.
 */
export type Service = object & {
    init?(...args: unknown[]): void;
    dispose?(): void;
};

export interface ServiceRegistration {
    /** Display name for logging/ordering. */
    name: string;
    /** Service instance. */
    service: Service;
    /** Dependencies (names of services that must init first). */
    dependsOn?: string[];
    /** Start-order weight (lower = earlier). Default 100. */
    order?: number;
    /** Init arguments forwarded to service.init(). */
    initArgs?: unknown[];
    /** Whether a failure here is fatal. Default false. */
    critical?: boolean;
}

/**
 * ServiceRegistry — ordered init / dispose lifecycle manager + DI container.
 *
 * Usage:
 *   // Register
 *   const reg = ServiceRegistry.get_default();
 *   reg.register({ name: 'Weather', service: Weather.get_default(), initArgs: [settings] });
 *   reg.initAll();    // in dependency/order sequence
 *
 *   // Resolve (replaces get_default() singletons)
 *   const weather = ServiceRegistry.get_default().resolve<Weather>('Weather');
 *
 *   // Test mocking
 *   reg.override('Weather', fakeWeather);
 *   reg.reset(); // clear all for test isolation
 */
export default class ServiceRegistry {
    private static instance: ServiceRegistry;

    static get_default(): ServiceRegistry {
        if (!this.instance) this.instance = new ServiceRegistry();
        return this.instance;
    }

    #registrations: ServiceRegistration[] = [];
    #initialized = false;

    /** Register one or more services. Idempotent for the same name. */
    register(...regs: ServiceRegistration[]) {
        for (const reg of regs) {
            const existing = this.#registrations.findIndex(
                r => r.name === reg.name
            );
            if (existing >= 0) {
                this.#registrations[existing] = reg;
            } else {
                this.#registrations.push(reg);
            }
        }
    }

    /**
     * Override a registered service with a mock/fake (for testing).
     * Does not re-init; the caller must manage mock lifecycle.
     */
    override(name: string, mockService: Service) {
        const existing = this.#registrations.findIndex(r => r.name === name);
        if (existing >= 0) {
            this.#registrations[existing]!.service = mockService;
        } else {
            logger.warn(
                'serviceRegistry',
                `override("${name}") called but not registered — adding as new`
            );
            this.#registrations.push({name, service: mockService});
        }
    }

    /** Reset all registrations (for test isolation). */
    reset() {
        this.disposeAll();
    }

    /** Initialize all registered services in dependency/order sequence. */
    initAll(): boolean {
        if (this.#initialized) {
            logger.warn('serviceRegistry', 'initAll() called twice — skipping');
            return true;
        }
        this.#initialized = true;

        const sorted = this.#topologicalSort();
        let allOk = true;

        for (const reg of sorted) {
            const label = reg.name;
            perf.start(`service-${label}`, 'init');
            try {
                if (typeof reg.service.init !== 'function') {
                    logger.debug(
                        'serviceRegistry',
                        `${label} — no init method, skipping`
                    );
                } else if (reg.initArgs && reg.initArgs.length > 0) {
                    reg.service.init(...reg.initArgs);
                    logger.info('serviceRegistry', `${label} initialized`);
                } else {
                    reg.service.init();
                    logger.info('serviceRegistry', `${label} initialized`);
                }
            } catch (e) {
                logger.error(
                    'serviceRegistry',
                    `${label} init failed:`,
                    e instanceof Error ? e.message : String(e)
                );
                if (reg.critical) {
                    logger.error(
                        'serviceRegistry',
                        `${label} is critical — aborting`
                    );
                    return false;
                }
                allOk = false;
            }
            perf.stop(`service-${label}`, 'init');
        }

        return allOk;
    }

    /** Dispose all services in reverse init order. */
    disposeAll() {
        const sorted = this.#topologicalSort();
        for (let i = sorted.length - 1; i >= 0; i--) {
            const reg = sorted[i]!;
            if (reg.service.dispose) {
                try {
                    reg.service.dispose();
                    logger.info('serviceRegistry', `${reg.name} disposed`);
                } catch (e) {
                    logger.error(
                        'serviceRegistry',
                        `${reg.name} dispose failed:`,
                        e instanceof Error ? e.message : String(e)
                    );
                }
            }
        }
        this.#registrations = [];
        this.#initialized = false;
    }

    /** Resolve a registered service by name (typed convenience). */
    resolve<T>(name: string): T {
        const reg = this.#registrations.find(r => r.name === name);
        if (!reg) {
            throw new Error(
                `ServiceRegistry: "${name}" not registered. ` +
                    'Available: ' +
                    this.#registrations.map(r => `"${r.name}"`).join(', ') +
                    '.'
            );
        }
        return reg.service as T;
    }

    /** Check if a name is registered. */
    has(name: string): boolean {
        return this.#registrations.some(r => r.name === name);
    }

    /** Resolve init order via topological sort (respects dependsOn + order). */
    #topologicalSort(): ServiceRegistration[] {
        const visited = new Set<string>();
        const sorted: ServiceRegistration[] = [];
        const visiting = new Set<string>();

        const visit = (name: string) => {
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                logger.warn(
                    'serviceRegistry',
                    `circular dependency detected involving "${name}"`
                );
                return;
            }
            visiting.add(name);
            const reg = this.#registrations.find(r => r.name === name);
            if (reg?.dependsOn) {
                for (const dep of reg.dependsOn) {
                    visit(dep);
                }
            }
            visiting.delete(name);
            visited.add(name);
            if (reg) sorted.push(reg);
        };

        // Process in order of the `order` field (lowest first)
        const ordered = [...this.#registrations].sort(
            (a, b) => (a.order ?? 100) - (b.order ?? 100)
        );

        for (const reg of ordered) {
            visit(reg.name);
        }

        return sorted;
    }
}
