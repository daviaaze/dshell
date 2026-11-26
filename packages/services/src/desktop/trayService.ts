import Tray from 'gi://AstalTray';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';

/**
 * TrayService — reactive wrapper around AstalTray D-Bus proxy.
 *
 * Widgets bind to `items` instead of importing `gi://AstalTray` directly.
 */
@register
export default class TrayService extends Object {
    private static instance: TrayService;

    static get_default(): TrayService {
        if (!TrayService.instance) TrayService.instance = new TrayService();
        return TrayService.instance;
    }

    #tray: Tray.Tray | null = null;
    #initialized = false;
    #itemsHandlerId = 0;

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

        this.#itemsHandlerId = this.#tray.connect('notify::items', () => {
            this.notify('items');
        });
    }

    dispose() {
        if (this.#tray && this.#itemsHandlerId !== 0) {
            this.#tray.disconnect(this.#itemsHandlerId);
        }
        this.#itemsHandlerId = 0;
        this.#tray = null;
        this.#initialized = false;
    }
}

defineService({name: 'TrayService', service: TrayService.get_default()});
