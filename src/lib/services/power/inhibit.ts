import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import logger from '../../core/logger';

@register({GTypeName: 'IdleInhibit'})
export default class Inhibit extends Object {
    static instance: Inhibit;
    static get_default() {
        if (!this.instance) this.instance = new Inhibit();
        return this.instance;
    }

    #idle: boolean;
    #cookie: number;
    #app: Adw.Application | null = null;
    #duration = 0;
    #elapsed = 0;
    #timerId: number | null = null;
    #initialized = false;

    @property
    get idle() {
        return this.#idle;
    }

    @property
    get remaining() {
        if (!this.#idle || this.#duration <= 0) return '';
        const secs = Math.max(
            0,
            Math.round((this.#duration - this.#elapsed) / 1000)
        );
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
            if (this.#cookie !== 0) this.#app?.uninhibit(this.#cookie);
            this.#cookie =
                this.#app?.inhibit(
                    null,
                    Gtk.ApplicationInhibitFlags.IDLE,
                    'toggled by shade-shell'
                ) ?? 0;
            this.#startTimer();
        } else {
            this.#stopTimer();
            if (this.#cookie !== 0) {
                this.#app?.uninhibit(this.#cookie);
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
        this.#timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#elapsed += 1000;
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

    init(app: Adw.Application) {
        if (this.#initialized) {
            logger.warn(
                'inhibit',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        this.#app = app;
    }

    constructor() {
        super();
        this.#idle = false;
        this.#cookie = 0;
        this.#initialized = false;
    }
}
