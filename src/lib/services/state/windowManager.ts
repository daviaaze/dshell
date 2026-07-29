import Astal from 'gi://Astal?version=4.0';
import Adw from 'gi://Adw?version=1';
import {Object, register} from 'gnim/gobject';
import {property} from '../../decorators';

// ── Generic window collection for multi-window types (bars, wallpapers, lockscreens) ──
function windowCollection<T extends Astal.Window>(
    initial: T[] = []
): {
    getAll: () => T[];
    add: (win: T) => void;
    remove: (win: T) => void;
} {
    const items: T[] = [...initial];
    return {
        getAll: () => items,
        add: (win: T) => {
            items.push(win);
        },
        remove: (win: T) => {
            const idx = items.indexOf(win);
            if (idx >= 0) items.splice(idx, 1);
        },
    };
}

@register({GTypeName: 'WindowManager'})
export default class WindowManager extends Object {
    static instance: WindowManager;

    static get_default() {
        if (!this.instance) this.instance = new WindowManager();
        return this.instance;
    }

    // Multi-window collections (one per monitor)
    #bars = windowCollection<Astal.Window>();
    #wallpapers = windowCollection<Astal.Window>();
    #lockscreens = windowCollection<Astal.Window>();

    // Single-window registrations
    #quicksettings: Astal.Window | null = null;
    #osd: Astal.Window | null = null;
    #applauncher: Astal.Window | null = null;
    #notifications: Astal.Window | null = null;
    #settings: Adw.Window | null = null;
    #dock: Astal.Window | null = null;
    // ── Getters ──

    @property
    get bars() {
        return this.#bars.getAll();
    }

    @property
    get wallpapers() {
        return this.#wallpapers.getAll();
    }

    @property
    get lockscreens() {
        return this.#lockscreens.getAll();
    }

    @property
    get quicksettings() {
        return this.#quicksettings;
    }

    @property
    get osd() {
        return this.#osd;
    }

    @property
    get applauncher() {
        return this.#applauncher;
    }

    @property
    get notifications() {
        return this.#notifications;
    }

    @property
    get settings() {
        return this.#settings;
    }

    @property
    get dock() {
        return this.#dock;
    }

    // ── Multi-window registration (bars, wallpapers, lockscreens) ──

    registerBar(win: Astal.Window) {
        this.#bars.add(win);
        this.notify('bars');
    }

    unregisterBar(win: Astal.Window) {
        this.#bars.remove(win);
        this.notify('bars');
    }

    registerWallpaper(win: Astal.Window) {
        this.#wallpapers.add(win);
        this.notify('wallpapers');
    }

    unregisterWallpaper(win: Astal.Window) {
        this.#wallpapers.remove(win);
        this.notify('wallpapers');
    }

    registerLockscreen(win: Astal.Window) {
        this.#lockscreens.add(win);
        this.notify('lockscreens');
    }

    unregisterLockscreen(win: Astal.Window) {
        this.#lockscreens.remove(win);
        this.notify('lockscreens');
    }

    // ── Single-window setters ──

    setQuicksettings(win: Astal.Window | null) {
        this.#quicksettings = win;
        this.notify('quicksettings');
    }

    setOsd(win: Astal.Window | null) {
        this.#osd = win;
        this.notify('osd');
    }

    setApplauncher(win: Astal.Window | null) {
        this.#applauncher = win;
        this.notify('applauncher');
    }

    setNotifications(win: Astal.Window | null) {
        this.#notifications = win;
        this.notify('notifications');
    }

    setSettings(win: Adw.Window | null) {
        this.#settings = win;
        this.notify('settings');
    }

    registerDock(win: Astal.Window) {
        this.#dock = win;
        this.notify('dock');
    }

    unregisterDock(win: Astal.Window) {
        if (this.#dock === win) {
            this.#dock = null;
            this.notify('dock');
        }
    }

    setOverlay(_win: Astal.Window | null) {
        // Reserved for overlay window tracking
    }
}
