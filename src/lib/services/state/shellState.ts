import {Object as GObject, register, property} from 'gnim/gobject';
import Gio from 'gi://Gio?version=2.0';
import {bus} from '#/lib/core/eventBus';
import ServiceRegistry from '#/lib/core/serviceRegistry';
import logger from '#/lib/core/logger';

@register({GTypeName: 'ShellState'})
export default class ShellState extends GObject {
    static instance: ShellState;

    static get_default() {
        if (!this.instance) this.instance = new ShellState();
        return this.instance;
    }

    #launcherOpen = false;
    #launcherQuery = '';
    #qsOpen = false;
    #screenlocked = false;

    @property(Boolean)
    get launcherOpen() {
        return this.#launcherOpen;
    }

    @property(Boolean)
    get launcherQuery() {
        return this.#launcherQuery;
    }

    set launcherQuery(v: string) {
        this.#launcherQuery = v;
        this.notify('launcher-query');
    }

    set launcherOpen(v: boolean) {
        logger.debug(
            'state',
            `ShellState.launcherOpen ${this.#launcherOpen} -> ${v}`
        );
        this.#launcherOpen = v;
        this.notify('launcher-open');
    }

    @property(Boolean)
    get qsOpen() {
        return this.#qsOpen;
    }

    set qsOpen(v: boolean) {
        logger.debug('state', `ShellState.qsOpen ${this.#qsOpen} -> ${v}`);
        this.#qsOpen = v;
        this.notify('qs-open');
    }

    @property(Boolean)
    get screenlocked() {
        return this.#screenlocked;
    }

    set screenlocked(v: boolean) {
        logger.info(
            'state',
            `ShellState.screenlocked ${this.#screenlocked} -> ${v}`
        );
        this.#screenlocked = v;
        this.notify('screenlocked');
        if (v) bus.emit('shell:lockscreen');
    }

    toggleLauncher() {
        this.launcherQuery = '';
        this.launcherOpen = !this.#launcherOpen;
        bus.emit('shell:launcher:toggle');
    }

    openClipboard() {
        this.launcherQuery = '>';
        this.launcherOpen = true;
    }

    toggleClipboard() {
        if (this.#launcherOpen && this.#launcherQuery === '>') {
            this.launcherQuery = '';
            this.launcherOpen = false;
        } else {
            this.launcherQuery = '>';
            this.launcherOpen = true;
        }
    }

    /** Lock the session (show lockscreen). */
    lock() {
        this.screenlocked = true;
    }

    /** Unlock the session (hide lockscreen). */
    unlock() {
        this.screenlocked = false;
    }

    /** Close the launcher and clear the search query. */
    closeLauncher() {
        this.#launcherQuery = '';
        this.#launcherOpen = false;
        this.notify('launcher-query');
        this.notify('launcher-open');
    }

    /** Close the quick settings panel. */
    closeQuickSettings() {
        this.qsOpen = false;
    }

    toggleQuickSettings() {
        this.qsOpen = !this.#qsOpen;
        bus.emit('shell:qs:toggle');
    }

    toggleBar() {
        const wm =
            ServiceRegistry.get_default().resolve<
                import('#/lib/services/state/windowManager').default
            >('WindowManager');
        wm.bars.forEach(bar => (bar.visible = !bar.visible));
    }

    toggleWindowSwitcher() {
        this.#onToggleWindowSwitcher?.();
        bus.emit('shell:windowswitcher:toggle');
    }

    #onToggleSettings: (() => void) | null = null;
    #onToggleWindowSwitcher: (() => void) | null = null;

    /**
     * Register widget-level action callbacks.
     * This inverts the dependency: instead of ShellState importing
     * widget code, widgets register their callbacks here.
     */
    registerWidgetActions(opts: {
        onToggleSettings?: () => void;
        onToggleWindowSwitcher?: () => void;
    }) {
        if (opts.onToggleSettings)
            this.#onToggleSettings = opts.onToggleSettings;
        if (opts.onToggleWindowSwitcher)
            this.#onToggleWindowSwitcher = opts.onToggleWindowSwitcher;
    }

    toggleSettings() {
        this.#onToggleSettings?.();
    }

    /** Register GAction commands for shell UI state. */
    registerCommands(app: Gio.Application) {
        const actions: Record<string, () => void> = {
            'toggle-applauncher': () => this.toggleLauncher(),
            'toggle-quicksettings': () => this.toggleQuickSettings(),
            'toggle-bar': () => this.toggleBar(),
            'toggle-windowswitcher': () => this.toggleWindowSwitcher(),
            'toggle-settings': () => this.toggleSettings(),
            'toggle-clipboard': () => this.toggleClipboard(),
            'open-clipboard': () => this.openClipboard(),
            lockscreen: () => this.lock(),
        };
        for (const [name, fn] of Object.entries(actions)) {
            const action = Gio.SimpleAction.new(name, null);
            action.connect('activate', fn);
            app.add_action(action);
        }
    }
}
