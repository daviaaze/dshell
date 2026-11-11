import {describe, expect, it, run} from '../../../services/src/__tests__/test-runner';
import {CompositorConfigStore} from '../store';
import type {CompositorSeed, UserConfig} from '../types';

const seed: CompositorSeed = {
    version: 1,
    settings: {general: {gaps_in: 2, gaps_out: 4}},
    input: {},
    binds: [
        {
            id: 'launcher',
            keys: 'SUPER + SPACE',
            title: 'Launcher',
            category: 'Shell',
            action: {type: 'command', command: 'true'},
        },
        {
            id: 'terminal',
            keys: 'SUPER + RETURN',
            title: 'Terminal',
            category: 'Apps',
            action: {type: 'launch-app', desktopId: 'kitty'},
        },
    ],
    monitorRules: [],
    workspaceRules: [],
    windowRules: [],
    layerRules: [],
    gestures: [],
    curves: [],
    animations: [],
    startup: [],
    devices: [],
    plugins: [],
    layouts: {current: null, layouts: {}},
    extraLuaConfig: '',
};
function gapsIn(config: CompositorSeed): number {
    const general = config.settings.general;
    if (
        typeof general !== 'object' ||
        general === null ||
        Array.isArray(general) ||
        !('gaps_in' in general) ||
        typeof general.gaps_in !== 'number'
    )
        throw new Error('Expected numeric general.gaps_in');
    return general.gaps_in;
}

describe('CompositorConfigStore transactions', () => {
    it.async('applies then persists a valid edit before publishing it', async () => {
        const order: string[] = [];
        const store = new CompositorConfigStore(
            seed,
            {version: 1},
            {
                async apply() {
                    order.push('apply');
                },
                async persist() {
                    order.push('persist');
                },
            }
        );
        await store.edit({settings: {general: {gaps_in: 6}}});
        expect(order).toEqual(['apply', 'persist']);
        expect(store.effective.settings.general).toEqual({gaps_in: 6, gaps_out: 4});
    });

    it.async('rejects a conflicting chord without touching the adapter', async () => {
        let calls = 0;
        const store = new CompositorConfigStore(
            seed,
            {version: 1},
            {
                async apply() {
                    calls++;
                },
                async persist() {
                    calls++;
                },
            }
        );
        let rejected = false;
        try {
            await store.edit({binds: {terminal: {keys: 'SPACE + SUPER'}}});
        } catch {
            rejected = true;
        }
        expect(rejected).toBe(true);
        expect(calls).toBe(0);
        expect(store.user).toEqual({version: 1});
    });

    it.async('reverts the live compositor state if persistence fails', async () => {
        const transitions: string[] = [];
        const store = new CompositorConfigStore(
            seed,
            {version: 1},
            {
                async apply(previous, next) {
                    transitions.push(`${gapsIn(previous)}->${gapsIn(next)}`);
                },
                async persist(_user: UserConfig) {
                    throw new Error('disk full');
                },
            }
        );
        let rejected = false;
        try {
            await store.edit({settings: {general: {gaps_in: 8}}});
        } catch {
            rejected = true;
        }
        expect(rejected).toBe(true);
        expect(transitions).toEqual(['2->8', '8->2']);
        expect(gapsIn(store.effective)).toBe(2);
    });
});

run();
