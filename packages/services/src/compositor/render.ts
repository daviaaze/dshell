import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {readFile, writeFile} from '@shade/core/file';
import {renderHyprlandLua, resolveUserConfig, type CompositorSeed} from '@shade/compositor-model';
import {configPaths, loadUserConfig} from './configFile';

function requireSeed(path: string): CompositorSeed {
    const seed = JSON.parse(readFile(path)) as CompositorSeed;
    const arrays = [
        seed.binds,
        seed.monitorRules,
        seed.workspaceRules,
        seed.windowRules,
        seed.layerRules,
        seed.gestures,
        seed.curves,
        seed.animations,
        seed.startup,
        seed.devices,
        seed.plugins,
    ];
    if (
        seed.version !== 1 ||
        !seed.settings ||
        !seed.input ||
        arrays.some((value) => !Array.isArray(value)) ||
        !seed.layouts ||
        !seed.layouts.layouts ||
        typeof seed.extraLuaConfig !== 'string'
    )
        throw new Error(`invalid compositor seed schema at ${path}`);
    return seed;
}

export function renderCompositorConfig(): string {
    const paths = configPaths();
    const seed = requireSeed(paths.seed);
    const loaded = loadUserConfig(paths);
    for (const message of loaded.errors)
        console.error(`Shade compositor: ${message}; using Nix defaults.`);
    const resolved = resolveUserConfig(seed, loaded.user);
    if (resolved.errors.length)
        console.error(
            `Shade compositor: user config rejected; using Nix defaults:\n${resolved.errors.join('\n')}`
        );

    const runtimeDir = GLib.getenv('XDG_RUNTIME_DIR') ?? GLib.get_user_runtime_dir();
    const output =
        GLib.getenv('SHADE_COMPOSITOR_RENDERED') ??
        GLib.build_filenamev([runtimeDir, 'shade', 'hyprland.lua']);
    const file = writeFile(output, renderHyprlandLua(resolved.effective));
    file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
    return output;
}
