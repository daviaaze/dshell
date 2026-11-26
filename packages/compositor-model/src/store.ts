import {resolveUserConfig, type CompositorSeed, type LuaValue, type UserConfig} from './index';

export interface CompositorStoreAdapter {
    load?(): UserConfig;
    apply(previous: CompositorSeed, next: CompositorSeed): Promise<void>;
    persist(user: UserConfig): Promise<UserConfig | void>;
}

function mergeValues(
    previous: Record<string, LuaValue> = {},
    update: Record<string, LuaValue> = {}
): Record<string, LuaValue> {
    const next = {...previous};
    for (const [key, value] of Object.entries(update)) {
        const oldValue = next[key];
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            oldValue !== null &&
            typeof oldValue === 'object' &&
            !Array.isArray(oldValue)
        )
            next[key] = mergeValues(oldValue, value);
        else next[key] = value;
    }
    return next;
}

function mergePatch(current: UserConfig, patch: Partial<UserConfig>): UserConfig {
    const next: UserConfig = {...current, ...patch, version: 1};
    if (patch.settings) next.settings = mergeValues(current.settings, patch.settings);
    if (patch.input) next.input = mergeValues(current.input, patch.input);
    if (patch.binds) {
        next.binds = {...current.binds};
        for (const [id, override] of Object.entries(patch.binds))
            Object.defineProperty(next.binds, id, {
                value: {...current.binds?.[id], ...override},
                enumerable: true,
                configurable: true,
                writable: true,
            });
    }
    if (patch.windowRules) {
        next.windowRules = {...current.windowRules};
        for (const [id, override] of Object.entries(patch.windowRules))
            Object.defineProperty(next.windowRules, id, {
                value: {...current.windowRules?.[id], ...override},
                enumerable: true,
                configurable: true,
                writable: true,
            });
    }
    if (patch.startup) {
        next.startup = {...current.startup};
        for (const [id, override] of Object.entries(patch.startup))
            Object.defineProperty(next.startup, id, {
                value: {...current.startup?.[id], ...override},
                enumerable: true,
                configurable: true,
                writable: true,
            });
    }
    if (patch.layouts) {
        next.layouts = {
            ...current.layouts,
            ...patch.layouts,
            layouts: {...current.layouts?.layouts, ...patch.layouts.layouts},
        };
    }
    return next;
}

/** Serializes edits and commits only after live apply and persistence both succeed. */
export class CompositorConfigStore {
    #user: UserConfig;
    #effective: CompositorSeed;
    #pending: Promise<void> = Promise.resolve();

    constructor(
        readonly seed: CompositorSeed,
        initial: UserConfig,
        private readonly adapter: CompositorStoreAdapter
    ) {
        const resolved = resolveUserConfig(seed, initial);
        if (resolved.errors.length) throw new Error(resolved.errors.join('\n'));
        this.#user = initial;
        this.#effective = resolved.effective;
    }

    get user(): UserConfig {
        return this.#user;
    }

    get effective(): CompositorSeed {
        return this.#effective;
    }

    edit(patch: Partial<UserConfig>): Promise<CompositorSeed> {
        const operation = this.#pending.then(() => this.#edit(patch));
        this.#pending = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }

    async #edit(patch: Partial<UserConfig>): Promise<CompositorSeed> {
        const current = this.adapter.load?.() ?? this.#user;
        const loaded = resolveUserConfig(this.seed, current);
        if (loaded.errors.length) throw new Error(loaded.errors.join('\n'));
        const nextUser = mergePatch(current, patch);
        const resolved = resolveUserConfig(this.seed, nextUser);
        if (resolved.errors.length) throw new Error(resolved.errors.join('\n'));
        const previous = this.#effective;
        const next = resolved.effective;
        try {
            await this.adapter.apply(previous, next);
        } catch (cause) {
            await this.#rollback(next, previous, cause);
        }
        let committed = nextUser;
        try {
            committed = (await this.adapter.persist(nextUser)) ?? nextUser;
        } catch (cause) {
            await this.#rollback(next, previous, cause);
        }
        this.#user = committed;
        this.#effective = resolveUserConfig(this.seed, committed).effective;
        return this.#effective;
    }

    async #rollback(
        next: CompositorSeed,
        previous: CompositorSeed,
        cause: unknown
    ): Promise<never> {
        try {
            await this.adapter.apply(next, previous);
        } catch (rollbackError) {
            throw new AggregateError(
                [cause, rollbackError],
                'compositor config change failed and rollback was unsuccessful'
            );
        }
        throw cause;
    }
}
