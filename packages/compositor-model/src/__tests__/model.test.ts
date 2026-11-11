import {describe, expect, it, run} from '../../../services/src/__tests__/test-runner';
import {
    mergeCompositorConfig,
    migrateLegacyLayoutStore,
    planBindingDiff,
    renderBindLua,
    renderConfigOptionLua,
    renderDpmsLua,
    renderHyprlandLua,
    renderMonitorLua,
    renderWorkspaceRuleLua,
    renderKeystrokeOverlaySubscriptionLua,
    resolveUserConfig,
    validateUserConfig,
} from '../index';
import type {BindSpec, CompositorSeed, UserConfig} from '../types';

const seed: CompositorSeed = {
    version: 1,
    settings: {general: {gaps_in: 4}},
    input: {kb_layout: 'br'},
    binds: [
        {
            id: 'launcher',
            keys: 'SUPER + SPACE',
            title: 'Abrir lançador',
            category: 'Shell',
            action: {
                type: 'shell-action',
                name: 'toggle-applauncher',
                command: 'gdbus call --session --dest com.caioasmuniz.shade_shell',
            },
        },
        {
            id: 'terminal',
            keys: 'SUPER + RETURN',
            title: 'Terminal',
            category: 'Aplicativos',
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

describe('compositor configuration model', () => {
    it('overrides a seeded bind by stable id and retains unrelated seed entries', () => {
        const user: UserConfig = {
            version: 1,
            binds: {launcher: {keys: 'SUPER + D'}, terminal: {disabled: true}},
        };
        const result = mergeCompositorConfig(seed, user);
        expect(result.binds.map((bind) => [bind.id, bind.keys])).toEqual([
            ['launcher', 'SUPER + D'],
        ]);
    });
    it('accepts user-defined application shortcuts and rejects chord collisions', () => {
        const bind: BindSpec = {
            id: 'app.org.example.video',
            keys: 'SUPER + F8',
            title: 'Video Player',
            category: 'Aplicativos',
            action: {type: 'launch-app', desktopId: 'org.example.video'},
        };
        const result = resolveUserConfig(seed, {version: 1, binds: {[bind.id]: bind}});
        expect(result.errors).toEqual([]);
        expect(result.effective.binds.find((entry) => entry.id === bind.id)).toEqual(bind);

        const conflict = resolveUserConfig(seed, {
            version: 1,
            binds: {[bind.id]: {...bind, keys: 'SUPER + SPACE'}},
        });
        expect(conflict.errors.some((message) => message.includes('launcher'))).toBe(true);
    });
    it('migrates monitor-layouts.json without changing profile data', () => {
        const legacy = {
            version: 1,
            current: 'desk',
            layouts: {
                desk: {
                    monitors: [
                        {
                            name: 'DP-1',
                            resolution: '2560x1440@144',
                            position: '0x0',
                            scale: 1,
                            transform: 0,
                            vrr: null,
                            disabled: false,
                        },
                    ],
                    workspaces: {1: 'DP-1'},
                },
            },
        };
        const migrated = migrateLegacyLayoutStore(legacy);
        expect(migrated.errors).toEqual([]);
        expect(migrated.user.layouts?.current).toBe('desk');
        expect(migrated.user.layouts?.layouts?.desk).toEqual(legacy.layouts.desk);
        expect(legacy.layouts.desk.workspaces[1]).toBe('DP-1');
    });

    it('plans unbind-before-bind operations and avoids unchanged IPC', () => {
        const before = seed.binds;
        const after = before.map((bind) =>
            bind.id === 'launcher' ? {...bind, keys: 'SUPER + D'} : bind
        );
        const operations = planBindingDiff(before, after);
        expect(operations.map((operation) => operation.type)).toEqual(['unbind', 'bind']);
        expect(operations[0]?.type === 'unbind' ? operations[0].keys : '').toBe('SUPER + SPACE');
        expect(planBindingDiff(before, before).length).toBe(0);
    });
    it('rejects duplicate active chords and identifies both bind ids', () => {
        const user: UserConfig = {
            version: 1,
            binds: {terminal: {keys: 'SPACE + SUPER'}},
        };
        const errors = validateUserConfig(seed, user);
        expect(
            errors.some((error) => error.includes('launcher') && error.includes('terminal'))
        ).toBe(true);
    });

    it('renders safe Lua for model values and app launch metadata', () => {
        const lua = renderHyprlandLua(seed);
        expect(lua.includes('hl.bind("SUPER + SPACE"')).toBe(true);
        expect(lua.includes('kitty.desktop')).toBe(true);
        expect(lua.includes('hl.config({')).toBe(true);
        expect(lua.includes('undefined')).toBe(false);
    });
    it('emits native rule and startup sections instead of flattening them into config', () => {
        const lua = renderHyprlandLua({
            ...seed,
            settings: {...seed.settings, envd: ['SESSION,wayland']},
            monitorRules: [{output: ',', mode: 'preferred', position: 'auto', scale: 1}],
            workspaceRules: [{workspace: 'special:scratchpad', default: true}],
            windowRules: [
                {
                    id: 'smart-float',
                    match: {float: true, class: 'dialog'},
                    effects: {center: true},
                },
            ],
            layerRules: [{match: {namespace: '^shade$'}, effects: {blur: true}}],
            gestures: [{fingers: 3, direction: 'vertical', action: 'workspace'}],
            curves: [
                {
                    name: 'adw',
                    type: 'bezier',
                    points: [
                        [0.25, 0.1],
                        [0.25, 1],
                    ],
                },
            ],
            animations: [{leaf: 'windows', enabled: true, speed: 3, bezier: 'adw'}],
            startup: [
                {id: 'bar', command: 'shade-shell toggle bar', enabled: true, phase: 'start'},
            ],
            devices: [{name: 'touchpad', sensitivity: 0.2}],
            plugins: ['/nix/store/plugin.so'],
        });
        for (const item of [
            'hl.monitor(',
            'hl.workspace_rule(',
            'hl.window_rule(',
            'hl.layer_rule(',
            'hl.gesture(',
            'hl.curve("adw", {',
            'hl.animation(',
            'hl.device(',
            'hl.plugin.load(',
            'hl.on("hyprland.start"',
            'hl.env("SESSION", "wayland", true)',
        ])
            expect(lua.includes(item)).toBe(true);
        expect(lua.indexOf('hl.plugin.load') < lua.indexOf('hl.config')).toBe(true);
    });
    it('escapes user-visible Lua strings and command payloads', () => {
        const bind: BindSpec = {
            id: 'custom',
            keys: 'SUPER + F12',
            title: 'Say "hello"\nnow',
            category: 'Custom',
            action: {type: 'command', command: 'printf "safe"\n'},
        };
        const lua = renderBindLua(bind);
        expect(lua.includes('description = "Say \\"hello\\"\\nnow"')).toBe(true);
        expect(lua.includes('hl.dsp.exec_cmd("printf \\"safe\\"\\n")')).toBe(true);
        const resize = renderBindLua({
            ...bind,
            id: 'resize',
            action: {type: 'hypr-dispatch', name: 'resize'},
        });
        expect(resize.includes('hl.dsp.window.resize()')).toBe(true);
    });
    it('renders typed runtime monitor, workspace, option, and DPMS calls', () => {
        const monitor = renderMonitorLua({
            name: 'DP-1',
            resolution: '2560x1440@120',
            position: 'auto',
            scale: 1,
            transform: 0,
            vrr: null,
            disabled: false,
        });
        expect(monitor).toBe(
            'hl.monitor({["output"] = "DP-1", ["mode"] = "2560x1440@120", ["position"] = "auto", ["scale"] = "1", ["transform"] = 0, ["vrr"] = -1, ["disabled"] = false})'
        );
        expect(renderWorkspaceRuleLua('1', 'DP-1')).toBe(
            'hl.workspace_rule({workspace="1", monitor="DP-1"})'
        );
        expect(renderConfigOptionLua('input:natural_scroll', true)).toBe(
            'hl.config({["input.natural_scroll"]=true})'
        );
        expect(renderDpmsLua(false)).toBe('hl.dsp.dpms({action="off"})');
        expect(renderDpmsLua(true, 'DP-1')).toBe('hl.dsp.dpms({action="on", monitor="DP-1"})');
    });
    it('registers a removable key hook only on explicit enable', () => {
        const enabled = renderKeystrokeOverlaySubscriptionLua(true);
        expect(enabled.includes('hl.on("input.keyboard.key"')).toBe(true);
        expect(enabled.includes('if state ~= 2 then')).toBe(true);
        expect(enabled.includes('tostring(state)')).toBe(true);
        expect(enabled.includes('shade-key:')).toBe(true);

        const disabled = renderKeystrokeOverlaySubscriptionLua(false);
        expect(disabled.includes(':remove()')).toBe(true);
        expect(disabled.includes('= nil')).toBe(true);
    });
});

run();
