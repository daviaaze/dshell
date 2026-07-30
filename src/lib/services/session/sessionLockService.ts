import SessionLock from 'gi://Gtk4SessionLock';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Object, register, signal} from 'gnim/gobject';
import logger from '../../core/logger';

/**
 * Encapsulates the Gtk4SessionLock lifecycle so widgets don't import
 * SessionLock directly.
 *
 * Widgets create bindings to shellState and call lock()/unlock()
 * through this service. Window registration uses assignWindow().
 */
@register
export default class SessionLockService extends Object {
    private static instance: SessionLockService;

    static get_default() {
        if (!this.instance) this.instance = new SessionLockService();
        return this.instance;
    }

    #lock: SessionLock.Instance;

    constructor() {
        super();
        this.#lock = SessionLock.Instance.new();
    }

    // ── Signals ──

    /** Emitted when the session lock is acquired. */
    @signal
    locked(): void {}

    /** Emitted when the session lock is released. */
    @signal
    unlocked(): void {}

    // ── Public API ──

    /** Request the session to be locked. */
    lock() {
        logger.info('session-lock', 'locking session');
        this.#lock.lock();
        this.locked();
    }

    /** Release the session lock. */
    unlock() {
        logger.info('session-lock', 'unlocking session');
        this.#lock.unlock();
        this.unlocked();
    }

    /**
     * Assign a window to a monitor in the locked session.
     * Called during widget layout — the widget passes its window
     * and monitor, the service handles the protocol call.
     */
    assignWindow(window: Gtk.Window, monitor: Gdk.Monitor) {
        this.#lock.assign_window_to_monitor(window, monitor);
    }
}
