import GLib from 'gi://GLib?version=2.0';
import {readFile, writeFile} from '@shade/core/file';
import {migrateLegacyLayoutStore, type UserConfig} from '@shade/compositor-model';

export interface CompositorConfigPaths {
    seed: string;
    user: string;
    legacyLayouts: string;
}

export function configPaths(): CompositorConfigPaths {
    const configDir = GLib.get_user_config_dir();
    return {
        seed: GLib.getenv('SHADE_COMPOSITOR_SEED') ?? '/etc/xdg/shade/compositor-seed.json',
        user:
            GLib.getenv('SHADE_COMPOSITOR_CONFIG') ??
            GLib.build_filenamev([configDir, 'shade', 'compositor.json']),
        legacyLayouts: GLib.build_filenamev([configDir, 'shade', 'monitor-layouts.json']),
    };
}

export function loadUserConfig(paths: CompositorConfigPaths): {user: UserConfig; errors: string[]} {
    if (GLib.file_test(paths.user, GLib.FileTest.EXISTS)) {
        try {
            return {user: JSON.parse(readFile(paths.user)) as UserConfig, errors: []};
        } catch (cause) {
            return {user: {version: 1}, errors: [`Could not parse ${paths.user}: ${cause}`]};
        }
    }
    if (!GLib.file_test(paths.legacyLayouts, GLib.FileTest.EXISTS))
        return {user: {version: 1}, errors: []};
    try {
        const migration = migrateLegacyLayoutStore(JSON.parse(readFile(paths.legacyLayouts)));
        if (migration.errors.length) return {user: {version: 1}, errors: migration.errors};
        persistUserConfig(paths.user, migration.user);
        return migration;
    } catch (cause) {
        return {user: {version: 1}, errors: [`Could not migrate ${paths.legacyLayouts}: ${cause}`]};
    }
}

export function persistUserConfig(path: string, user: UserConfig): void {
    writeFile(path, `${JSON.stringify(user, null, 2)}\n`);
}
