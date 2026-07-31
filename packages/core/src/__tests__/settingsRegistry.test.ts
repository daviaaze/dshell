/**
 * Tests for the settings registry — schema self-declaration and lazy accessors.
 *
 * Run via: pnpm test
 */

import {
    defineSettings,
    getRegisteredSchemas,
    initSettingsRoot,
    resetSettingsRegistry,
} from '../settingsRegistry';
import {describe, it, expect, run} from './test-runner';

describe('settingsRegistry', () => {
    it('defineSettings registers schema with conventional id/path', () => {
        resetSettingsRegistry();
        defineSettings('weather', s => s.key('latitude', 'd', {default: 0}));
        const schemas = getRegisteredSchemas();
        expect(schemas.length).toBe(1);
        expect(schemas[0]!.id.endsWith('.weather')).toBeTruthy();
        expect(schemas[0]!.path!.endsWith('/weather/')).toBeTruthy();
    });

    it('preserves declaration order', () => {
        resetSettingsRegistry();
        defineSettings('a', s => s);
        defineSettings('b', s => s);
        defineSettings('c', s => s);
        const ids = getRegisteredSchemas().map(s => s.id);
        expect(ids[0]!.endsWith('.a')).toBeTruthy();
        expect(ids[1]!.endsWith('.b')).toBeTruthy();
        expect(ids[2]!.endsWith('.c')).toBeTruthy();
    });

    it('duplicate name throws', () => {
        resetSettingsRegistry();
        defineSettings('dup', s => s);
        expect(() => defineSettings('dup', s => s)).toThrow();
    });

    it('accessor throws before initSettingsRoot', () => {
        resetSettingsRegistry();
        const accessor = defineSettings('early', s => s);
        expect(() => accessor()).toThrow();
    });

    it('accessor returns group after initSettingsRoot', () => {
        resetSettingsRegistry();
        const accessor = defineSettings('bar', s => s);
        initSettingsRoot(() => ({fake: true}));
        expect((accessor() as unknown as {fake: boolean}).fake).toBe(true);
    });

    it('initSettingsRoot is idempotent (factory called once per schema)', () => {
        resetSettingsRegistry();
        defineSettings('once', s => s);
        let calls = 0;
        const factory = () => {
            calls++;
            return {};
        };
        initSettingsRoot(factory);
        initSettingsRoot(factory);
        expect(calls).toBe(1);
    });
});

run(import.meta.url);
