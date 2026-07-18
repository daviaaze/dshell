import GObject, {getter, register, setter} from 'gnim/gobject';
import Gio from 'gi://Gio?version=2.0';
import WindowManager from '#/lib/services/state/windowManager';
import {openSettings} from '#/widget';
import {toggleWindowSwitcher} from '#/widget/windowswitcher';
import logger from '#/lib/core/logger';

@register({GTypeName: 'ShellState'})
export default class ShellState extends GObject.Object {
    static instance: ShellState;

    static get_default() {
        if (!this.instance) this.instance = new ShellState();
        return this.instance;
    }

    #launcherOpen = false;
    #launcherQuery = '';
    #qsOpen = false;
    #screenlocked = false;

    @getter(Boolean)
    get launcherOpen() {
        return this.#launcherOpen;
    }

    @getter(String)
    get launcherQuery() {
        return this.#launcherQuery;
    }

    @setter(String)
    set launcherQuery(v: string) {
        this.#launcherQuery = v;
        this.notify('launcher-query');
    }

    @setter(Boolean)
    set launcherOpen(v: boolean) {
        logger.debug(
            'state',
            `ShellState.launcherOpen ${this.#launcherOpen} -> ${v}`
        );
        this.#launcherOpen = v;
        this.notify('launcher-open');
    }

    @getter(Boolean)
    get qsOpen() {
        return this.#qsOpen;
    }

    @setter(Boolean)
    set qsOpen(v: boolean) {
        logger.debug('state', `ShellState.qsOpen ${this.#qsOpen} -> ${v}`);
        this.#qsOpen = v;
        this.notify('qs-open');
    }

    @getter(Boolean)
    get screenlocked() {
        return this.#screenlocked;
    }

    @setter(Boolean)
    set screenlocked(v: boolean) {
        logger.info(
            'state',
            `ShellState.screenlocked ${this.#screenlocked} -> ${v}`
        );
        this.#screenlocked = v;
        this.notify('screenlocked');
    }

    toggleLauncher() {
        this.launcherQuery = '';
        this.launcherOpen = !this.#launcherOpen;
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

    toggleQuickSettings() {
        this.qsOpen = !this.#qsOpen;
    }

    toggleBar() {
        const wm = WindowManager.get_default();
        wm.bars.forEach(bar => (bar.visible = !bar.visible));
    }

    toggleWindowSwitcher() {
        toggleWindowSwitcher();
    }

    toggleSettings() {
        openSettings();
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
            lockscreen: () => {
                this.screenlocked = true;
            },
        };
        for (const [name, fn] of Object.entries(actions)) {
            const action = Gio.SimpleAction.new(name, null);
            action.connect('activate', fn);
            app.add_action(action);
        }
    }
}
