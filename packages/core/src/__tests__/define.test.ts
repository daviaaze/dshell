/**
 * Tests for the self-registration layer — defineService / defineWidget.
 *
 * Run via: pnpm test
 */

import {
    type AppContext,
    defineService,
    defineWidget,
    getWidgetActions,
    getWidgetDefs,
    initServices,
    resetDefineRegistry,
} from '../define';
import ServiceRegistry from '../serviceRegistry';
import {describe, expect, it, run} from './test-runner';

function fakeCtx(registry: ServiceRegistry): AppContext {
    return {app: null as unknown as AppContext['app'], registry};
}

describe('defineService', () => {
    it('initServices registers and inits with resolved initArgs', () => {
        resetDefineRegistry();
        const calls: unknown[][] = [];
        defineService({
            name: 'A',
            service: {init: (...args: unknown[]) => calls.push(args)},
            initArgs: () => [1, 2],
        });
        const registry = new ServiceRegistry();
        const ok = initServices(fakeCtx(registry));
        expect(ok).toBe(true);
        expect(registry.has('A')).toBe(true);
        expect(calls.length).toBe(1);
        expect(calls[0]).toEqual([1, 2]);
    });

    it('duplicate name throws', () => {
        resetDefineRegistry();
        defineService({name: 'dup', service: {}});
        expect(() => defineService({name: 'dup', service: {}})).toThrow();
    });

    it('initServices respects dependsOn order', () => {
        resetDefineRegistry();
        const order: string[] = [];
        defineService({
            name: 'second',
            service: {init: () => order.push('second')},
        });
        defineService({
            name: 'first',
            service: {init: () => order.push('first')},
        });
        defineService({
            name: 'dependent',
            service: {init: () => order.push('dependent')},
            dependsOn: ['first'],
        });
        const registry = new ServiceRegistry();
        initServices(fakeCtx(registry));
        expect(order.indexOf('first')).toBeLessThan(order.indexOf('dependent'));
    });

    it('initServices returns false on non-critical failure and continues', () => {
        resetDefineRegistry();
        let reached = false;
        defineService({
            name: 'bad',
            service: {
                init: () => {
                    throw new Error('boom');
                },
            },
        });
        defineService({
            name: 'after',
            service: {
                init: () => {
                    reached = true;
                },
            },
        });
        const registry = new ServiceRegistry();
        const ok = initServices(fakeCtx(registry));
        expect(ok).toBe(false);
        expect(reached).toBe(true);
    });

    it('initArgs factory receives the AppContext', () => {
        resetDefineRegistry();
        let seen: AppContext | null = null;
        defineService({
            name: 'ctx-aware',
            service: {init: () => {}},
            initArgs: (ctx) => {
                seen = ctx;
                return [];
            },
        });
        const registry = new ServiceRegistry();
        const ctx = fakeCtx(registry);
        initServices(ctx);
        expect(seen === ctx).toBe(true);
    });
});

describe('defineWidget', () => {
    it('collects defs in declaration order', () => {
        resetDefineRegistry();
        defineWidget({name: 'one', mount: () => null});
        defineWidget({name: 'two', mount: () => null});
        defineWidget({name: 'three', mount: () => null});
        expect(getWidgetDefs().map((w) => w.name)).toEqual(['one', 'two', 'three']);
    });

    it('re-declaring a name replaces the def in place', () => {
        resetDefineRegistry();
        const first = () => null;
        const second = () => null;
        defineWidget({name: 'w', mount: first});
        defineWidget({name: 'other', mount: () => null});
        defineWidget({name: 'w', mount: second});
        const defs = getWidgetDefs();
        expect(defs.length).toBe(2);
        expect(defs[0]!.name).toBe('w');
        expect(defs[0]!.mount).toBe(second);
    });

    it('getWidgetActions merges actions across defs', () => {
        resetDefineRegistry();
        const onToggleSettings = () => {};
        const onToggleWindowSwitcher = () => {};
        defineWidget({name: 's', mount: () => null, actions: {onToggleSettings}});
        defineWidget({
            name: 'w',
            mount: () => null,
            actions: {onToggleWindowSwitcher},
        });
        const actions = getWidgetActions();
        expect(actions.onToggleSettings).toBe(onToggleSettings);
        expect(actions.onToggleWindowSwitcher).toBe(onToggleWindowSwitcher);
    });

    it('lazy flag is preserved on the def', () => {
        resetDefineRegistry();
        defineWidget({name: 'lazy-one', mount: () => null, lazy: true});
        expect(getWidgetDefs()[0]!.lazy).toBe(true);
    });
});

run(import.meta.url);
