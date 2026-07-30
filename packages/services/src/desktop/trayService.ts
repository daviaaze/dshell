import {Object, register, property} from 'gnim/gobject';
import Tray from 'gi://AstalTray';
import logger from '@shade/core/logger';

/**
 * TrayService — reactive wrapper around AstalTray D-Bus proxy.
 *
 * Widgets bind to `items` instead of importing `gi://AstalTray` directly.
 */
@register
export default class TrayService extends Object {
    private static instance: TrayService;

    static get_default(): TrayService {
        if (!this.instance) this.instance = new TrayService();
        return this.instance;
    }

    #tray: Tray.Tray | null = null;
    #initialized = false;

    @property
    get items(): Tray.TrayItem[] {
        return this.#tray?.items ?? [];
    }

    init() {
        if (this.#initialized) return;
        this.#initialized = true;

        try {
            this.#tray = Tray.get_default();
        } catch (e) {
            logger.error('trayService', 'Failed to init AstalTray:', e);
            return;
        }

        this.#tray.connect('notify::items', () => {
            this.notify('items');
        });
    }

    dispose() {
        this.#tray = null;
        this.#initialized = false;
    }
}
