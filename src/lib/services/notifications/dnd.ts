import {Object, register, property} from 'gnim/gobject';
import GLib from 'gi://GLib?version=2.0';
import {bus} from '../../core/eventBus';
import {getNotifdSafe} from './guard';
import logger from '../../core/logger';

/**
 * Centralized Do Not Disturb service.
 *
 * Wraps AstalNotifd's dontDisturb behind a clean GObject interface.
 * Listens to bus events and emits changes so any widget or service
 * can react without importing AstalNotifd directly.
 *
 * Usage:
 * ```ts
 * import DndService from './dnd';
 *
 * DndService.get_default().dnd = true;       // enable DND
 * bus.emit('system:dnd:toggle');              // toggle via bus
 * ```
 *
 * If AstalNotifd is unavailable (foreign daemon), DND state is
 * stored locally and the dnd property still works for UI toggling,
 * but notifications won't actually be suppressed.
 */
@register({GTypeName: 'DndService'})
export default class DndService extends Object {
    static instance: DndService;

    static get_default() {
        if (!this.instance) this.instance = new DndService();
        return this.instance;
    }

    #dnd = false;
    #busSubscriptions: (() => void)[] = [];
    #initialized = false;

    @property
    get dnd() {
        return this.#dnd;
    }

    set dnd(v: boolean) {
        if (this.#dnd === v) return;
        this.#dnd = v;
        this.#syncToNotifd(v);
        logger.info('dnd', `DND ${v ? 'enabled' : 'disabled'}`);
        this.notify('dnd');
        bus.emit('system:dnd:changed', v);
    }

    toggle() {
        this.dnd = !this.#dnd;
    }

    init(): void {
        if (this.#initialized) return;
        this.#initialized = true;

        // Subscribe to bus events
        this.#busSubscriptions.push(
            bus.on('system:dnd:toggle', () => this.toggle())
        );
        this.#busSubscriptions.push(
            bus.on('system:dnd:set', v => {
                this.dnd = v;
            })
        );

        // Read initial state from Notifd (deferred — may not be available yet)
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const notifd = getNotifdSafe();
            if (notifd) {
                this.#dnd = notifd.dontDisturb;
                this.notify('dnd');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    #syncToNotifd(v: boolean): void {
        const notifd = getNotifdSafe();
        if (notifd) {
            notifd.dontDisturb = v;
        }
    }

    dispose(): void {
        for (const unsub of this.#busSubscriptions) {
            unsub();
        }
        this.#busSubscriptions = [];
        this.#initialized = false;
    }
}
