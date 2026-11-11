import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import {readFile} from '@shade/core/file';
import logger from '@shade/core/logger';
import {
    resolveUserConfig,
    type BindSpec,
    type CompositorSeed,
    type UserConfig,
} from '@shade/compositor-model';
import {CompositorConfigStore} from '@shade/compositor-model/store';
import {Object as GObject, property, register} from 'gnim/gobject';
import {configPaths, loadUserConfig, persistUserConfig} from './configFile';
import {CompositorPort} from './port';

const EMPTY_SEED: CompositorSeed = {
    version: 1,
    settings: {},
    input: {},
    binds: [],
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

@register
export default class CompositorSettings extends GObject {
    private static instance: CompositorSettings;

    static get_default(): CompositorSettings {
        if (!CompositorSettings.instance) CompositorSettings.instance = CompositorSettings.create();
        return CompositorSettings.instance;
    }

    static create(): CompositorSettings {
        const service = new CompositorSettings();
        service.#init();
        return service;
    }

    #controller: CompositorConfigStore | null = null;
    #path = '';
    #error = '';
    #port = new CompositorPort();

    @property
    get effectiveJson(): string {
        return JSON.stringify(this.#controller?.effective ?? EMPTY_SEED);
    }

    @property
    get error(): string {
        return this.#error;
    }

    @property
    get configPath(): string {
        return this.#path;
    }

    get defaults(): BindSpec[] {
        return this.#controller?.seed.binds ?? [];
    }
    get effective(): CompositorSeed {
        return this.#controller?.effective ?? EMPTY_SEED;
    }
    get disabledDefaults(): BindSpec[] {
        const disabled = this.#controller?.user.binds ?? {};
        return this.defaults.filter((bind) => disabled[bind.id]?.disabled === true);
    }

    getLaunchShortcut(desktopId: string): BindSpec | null {
        const wanted = desktopId.replace(/\.desktop$/i, '').toLowerCase();
        return (
            this.effective.binds.find(
                (bind) =>
                    bind.action.type === 'launch-app' &&
                    bind.action.desktopId.replace(/\.desktop$/i, '').toLowerCase() === wanted
            ) ?? null
        );
    }

    async setBindKeys(id: string, keys: string): Promise<void> {
        const bind = this.effective.binds.find((entry) => entry.id === id);
        if (!bind) throw new Error(`Unknown binding: ${id}`);
        await this.#edit({binds: {[id]: {keys}}});
    }

    async addBind(bind: BindSpec): Promise<void> {
        await this.#edit({binds: {[bind.id]: bind}});
    }

    async disableBind(id: string): Promise<void> {
        await this.#edit({binds: {[id]: {disabled: true}}});
    }

    async restoreBind(id: string): Promise<void> {
        const defaults = this.#controller?.seed.binds.find((bind) => bind.id === id);
        if (!defaults) throw new Error(`No Nix default exists for binding: ${id}`);
        await this.#edit({binds: {[id]: {...defaults, disabled: false}}});
    }

    #init(): void {
        const paths = configPaths();
        this.#path = paths.user;
        let seed = EMPTY_SEED;
        let user: UserConfig = {version: 1};
        try {
            if (!GLib.file_test(paths.seed, GLib.FileTest.EXISTS))
                throw new Error(`Compositor seed not found: ${paths.seed}`);
            seed = JSON.parse(readFile(paths.seed)) as CompositorSeed;
            const loaded = loadUserConfig(paths);
            user = loaded.user;
            if (loaded.errors.length) this.#setError(loaded.errors.join('\n'));
        } catch (cause) {
            this.#setError(String(cause));
            logger.error('compositor', 'failed to load compositor config:', cause);
        }
        const initial = resolveUserConfig(seed, user);
        if (initial.errors.length) {
            this.#setError(initial.errors.join('\n'));
            user = {version: 1};
        }
        const port = this.#port;
        this.#controller = new CompositorConfigStore(seed, user, {
            async apply(previous, next) {
                await port.applyBinds(previous.binds, next.binds);
            },
            async persist(nextUser) {
                persistUserConfig(paths.user, nextUser);
            },
        });
        this.notify('effective-json');
    }

    async #edit(patch: Partial<UserConfig>): Promise<void> {
        if (!this.#controller) throw new Error('Compositor settings are unavailable');
        try {
            await this.#controller.edit(patch);
            this.#error = '';
            this.notify('effective-json');
            this.notify('error');
        } catch (cause) {
            this.#setError(String(cause));
            throw cause;
        }
    }

    #setError(message: string): void {
        this.#error = message;
        this.notify('error');
    }
}

defineService({name: 'CompositorSettings', service: CompositorSettings.get_default()});
