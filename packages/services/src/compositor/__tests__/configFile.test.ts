import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {readFile, writeFile} from '@shade/core/file';
import type {CompositorSeed} from '@shade/compositor-model';
import {CompositorConfigStore} from '@shade/compositor-model/store';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import {LayoutService} from '../../display/layouts';
import {
    loadUserConfig,
    persistUserSettings,
    requireUserConfig,
    type CompositorConfigPaths,
} from '../configFile';

const seed: CompositorSeed = {
    version: 1,
    settings: {},
    input: {},
    binds: [
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

async function withConfig(test: (paths: CompositorConfigPaths) => Promise<void>): Promise<void> {
    const directory = GLib.dir_make_tmp('shade-compositor-test-XXXXXX');
    const paths = {
        seed: `${directory}/seed.json`,
        user: `${directory}/compositor.json`,
        legacyLayouts: `${directory}/monitor-layouts.json`,
    };
    try {
        await test(paths);
    } finally {
        for (const path of Object.values(paths))
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                Gio.File.new_for_path(path).delete(null);
        Gio.File.new_for_path(directory).delete(null);
    }
}

describe('shared compositor configuration persistence', () => {
    it.async('preserves unreadable and invalid user files without applying an edit', async () => {
        await withConfig(async (paths) => {
            for (const original of [
                '{invalid json',
                '{"version":2}',
                '{"version":1,"binds":null}',
                '{"version":1,"binds":{"terminal":null}}',
                '{"version":1,"layouts":{"layouts":{"broken":{"monitors":null}}}}',
            ]) {
                writeFile(paths.user, original);
                let applies = 0;
                const store = new CompositorConfigStore(
                    seed,
                    {version: 1},
                    {
                        load: () => requireUserConfig(paths, seed),
                        async apply() {
                            applies++;
                        },
                        async persist(user) {
                            return persistUserSettings(paths, seed, user);
                        },
                    }
                );
                let rejected = false;
                try {
                    await store.edit({binds: {terminal: {keys: 'SUPER + T'}}});
                } catch {
                    rejected = true;
                }
                expect(rejected).toBe(true);
                expect(applies).toBe(0);
                expect(readFile(paths.user)).toBe(original);
            }
        });
    });

    it.async('allows edits after an invalid user file is repaired', async () => {
        await withConfig(async (paths) => {
            writeFile(paths.user, '{invalid json');
            expect(loadUserConfig(paths).errors.length > 0).toBe(true);
            const store = new CompositorConfigStore(
                seed,
                {version: 1},
                {
                    load: () => requireUserConfig(paths, seed),
                    async apply() {},
                    async persist(user) {
                        return persistUserSettings(paths, seed, user);
                    },
                }
            );
            writeFile(paths.user, '{"version":1}');
            await store.edit({binds: {terminal: {keys: 'SUPER + T'}}});
            expect(requireUserConfig(paths, seed).binds?.terminal.keys).toBe('SUPER + T');
        });
    });

    it.async('preserves layouts saved both before and during a compositor edit', async () => {
        await withConfig(async (paths) => {
            writeFile(paths.user, '{"version":1}');
            const displays = new LayoutService({storePath: paths.user, autoApply: () => false});
            const layout = {
                monitors: [
                    {
                        name: 'DP-1',
                        resolution: 'preferred',
                        position: '0x0',
                        scale: 1,
                        transform: 0,
                        vrr: null,
                        disabled: false,
                    },
                ],
                workspaces: {},
            };
            const store = new CompositorConfigStore(seed, requireUserConfig(paths, seed), {
                load: () => requireUserConfig(paths, seed),
                async apply() {
                    expect(displays.save('Later', layout)).toBe(true);
                },
                async persist(user) {
                    return persistUserSettings(paths, seed, user);
                },
            });
            expect(displays.save('Docked', layout)).toBe(true);
            await store.edit({binds: {terminal: {keys: 'SUPER + T'}}});
            const saved = requireUserConfig(paths, seed);
            expect(Object.keys(saved.layouts?.layouts ?? {}).sort()).toEqual(['Docked', 'Later']);
            expect(store.user.layouts).toEqual(saved.layouts);
            expect(saved.binds?.terminal.keys).toBe('SUPER + T');
        });
    });

    it.async('preserves a file corrupted during apply and rolls the live edit back', async () => {
        await withConfig(async (paths) => {
            writeFile(paths.user, '{"version":1}');
            let applies = 0;
            const store = new CompositorConfigStore(
                seed,
                {version: 1},
                {
                    load: () => requireUserConfig(paths, seed),
                    async apply() {
                        if (++applies === 1) writeFile(paths.user, '{invalid during apply');
                    },
                    async persist(user) {
                        return persistUserSettings(paths, seed, user);
                    },
                }
            );
            let rejected = false;
            try {
                await store.edit({binds: {terminal: {keys: 'SUPER + T'}}});
            } catch {
                rejected = true;
            }
            expect(rejected).toBe(true);
            expect(applies).toBe(2);
            expect(readFile(paths.user)).toBe('{invalid during apply');
            expect(store.user).toEqual({version: 1});
        });
    });
});

await run();
