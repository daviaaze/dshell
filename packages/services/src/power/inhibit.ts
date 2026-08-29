import type Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';
const SS_BUS_NAME = 'org.freedesktop.ScreenSaver';
const SS_OBJECT_PATH = '/org/freedesktop/ScreenSaver';
const SS_INTERFACE = 'org.freedesktop.ScreenSaver';
const INHIBIT_APP_NAME = 'shade-shell';
const INHIBIT_REASON = 'keep awake';

@register
export default class Inhibit extends Object {
    private static instance: Inhibit;
    static get_default() {
        if (!Inhibit.instance) Inhibit.instance = new Inhibit();
        return Inhibit.instance;
    }

    #idle: boolean;
    #cookie: number;
    #app: Adw.Application | null = null;
    #duration = 0;
    #elapsed = 0;
    #timerId: number | null = null;
    #busSubscriptions: (() => void)[] = [];
    #proxy: Gio.DBusProxy | null = null;
    #initialized = false;

    @property
    get idle() {
        return this.#idle;
    }

    @property
    get remaining() {
        if (!this.#idle || this.#duration <= 0) return '';
        const secs = Math.max(0, Math.round((this.#duration - this.#elapsed) / 1000));
        const min = Math.floor(secs / 60);
        const sec = secs % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    setDuration(minutes: number) {
        this.#duration = minutes > 0 ? minutes * 60 * 1000 : 0;
        this.#elapsed = 0;
        if (this.#idle) {
            this.#startTimer();
            this.notify('remaining');
            return;
        }
        this.idle = true;
    }

    set idle(state) {
        if (state === this.#idle) return;
        this.#idle = state;
        logger.info(
            'inhibit',
            `idle ${state ? 'enabled' : 'disabled'}${state && this.#duration > 0 ? ' (' + this.#duration / 60000 + 'min)' : ''}`
        );
        if (state) {
            if (this.#cookie !== 0) this.#releaseInhibit(this.#cookie);
            this.#cookie = this.#requestInhibit();
            this.#startTimer();
        } else {
            this.#stopTimer();
            if (this.#cookie !== 0) {
                this.#releaseInhibit(this.#cookie);
                this.#cookie = 0;
            }
        }
        this.notify('idle');
    }

    #startTimer() {
        this.#stopTimer();
        if (this.#duration === 0) {
            this.#elapsed = 0;
            this.notify('remaining');
            return;
        }
        this.#elapsed = 0;
        this.notify('remaining');
        // 5-second granularity — nobody needs per-second precision for an
        // idle-inhibit countdown, and this cuts timer wakeups by 80%.
        this.#timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this.#elapsed += 5000;
            if (this.#elapsed >= this.#duration) {
                this.idle = false;
                return GLib.SOURCE_REMOVE;
            }
            this.notify('remaining');
            return GLib.SOURCE_CONTINUE;
        });
    }

    #stopTimer() {
        if (this.#timerId) {
            GLib.source_remove(this.#timerId);
            this.#timerId = null;
        }
    }

    #getProxy(): Gio.DBusProxy | null {
        if (!this.#proxy) {
            try {
                const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
                this.#proxy = Gio.DBusProxy.new_sync(
                    bus,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    SS_BUS_NAME,
                    SS_OBJECT_PATH,
                    SS_INTERFACE,
                    null
                );
            } catch (e) {
                logger.warn('inhibit', 'failed to create ScreenSaver DBus proxy:', e);
            }
        }
        return this.#proxy;
    }

    #requestInhibit(): number {
        const proxy = this.#getProxy();
        if (!proxy) return 0;
        try {
            const result = proxy.call_sync(
                'Inhibit',
                new GLib.Variant('(ss)', [INHIBIT_APP_NAME, INHIBIT_REASON]),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            if (!result) return 0;
            return result.get_child_value(0).get_uint32();
        } catch (e) {
            logger.warn('inhibit', 'ScreenSaver.Inhibit failed:', e);
            return 0;
        }
    }

    #releaseInhibit(cookie: number): void {
        if (cookie === 0) return;
        const proxy = this.#getProxy();
        if (!proxy) return;
        try {
            proxy.call_sync(
                'UnInhibit',
                new GLib.Variant('(u)', [cookie]),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
        } catch (e) {
            logger.warn('inhibit', 'ScreenSaver.UnInhibit failed:', e);
        }
    }

    init(app: Adw.Application) {
        if (this.#initialized) {
            logger.warn('inhibit', 'init() called but already initialized — skipping');
            return;
        }
        this.#initialized = true;
        this.#app = app;

        // Listen for inhibit commands from widgets via the bus
        this.#busSubscriptions.push(
            bus.on('power:inhibit:set-duration', (v) => this.setDuration(v))
        );
        this.#busSubscriptions.push(
            bus.on('power:inhibit:set-idle', (v) => {
                this.idle = v;
            })
        );
    }

    constructor() {
        super();
        this.#idle = false;
        this.#cookie = 0;
        this.#initialized = false;
    }
}

defineService({name: 'Inhibit', service: Inhibit.get_default(), initArgs: (ctx) => [ctx.app]});
