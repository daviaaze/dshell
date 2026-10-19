import Gdk from 'gi://Gdk?version=4.0';
import type Gtk from 'gi://Gtk?version=4.0';
import SessionLock from 'gi://Gtk4SessionLock';
import logger from '@shade/core/logger';
import {Object, register, signal} from 'gnim/gobject';

export interface SessionLockSignalSignatures extends Object.SignalSignatures {
    locked: SessionLockService['locked'];
    unlocked: SessionLockService['unlocked'];
    failed: SessionLockService['failed'];
    monitor: SessionLockService['monitor'];
}

/**
 * Encapsulates the Gtk4SessionLock lifecycle so widgets don't import
 * SessionLock directly.
 *
 * Widgets create bindings to shellState and call lock()/unlock()
 * through this service. Window registration uses assignWindow().
 */
@register
export default class SessionLockService extends Object {
    declare readonly $signals: SessionLockSignalSignatures;

    private static instance: SessionLockService;

    static get_default() {
        if (!SessionLockService.instance) SessionLockService.instance = new SessionLockService();
        return SessionLockService.instance;
    }

    #lock: SessionLock.Instance | null = null;
    #requested = false;
    #signalIds: number[] = [];
    #createLock: () => SessionLock.Instance;

    constructor(createLock: () => SessionLock.Instance = () => SessionLock.Instance.new()) {
        super();
        this.#createLock = createLock;
    }

    // ── Signals ──

    /** Emitted when the session lock is acquired. */
    @signal
    locked(): void {}

    /** Emitted when the session lock is released. */
    @signal
    unlocked(): void {}

    /** The compositor rejected this acquisition; the session is not authenticated. */
    @signal
    failed(): void {}

    /** Create an unrealized lock window for this output before mapping it. */
    @signal
    monitor(_monitor: Gdk.Monitor): void {}

    get isLocked(): boolean {
        return this.#lock?.is_locked() ?? false;
    }

    // ── Public API ──

    /** Request the session to be locked. */
    lock() {
        if (this.#requested) return;
        if (this.#lock) {
            for (const id of this.#signalIds) this.#lock.disconnect(id);
        }
        this.#lock = this.#createLock();
        this.#requested = true;
        this.#signalIds = [
            this.#lock.connect('monitor', (_lock, monitor: Gdk.Monitor) => this.monitor(monitor)),
            this.#lock.connect('locked', () => {
                logger.info('session-lock', 'compositor confirmed session lock');
                this.locked();
            }),
            this.#lock.connect('failed', () => {
                this.#requested = false;
                logger.error('session-lock', 'compositor rejected session lock');
                this.failed();
            }),
            this.#lock.connect('unlocked', () => {
                this.#requested = false;
                this.unlocked();
            }),
        ];
        logger.info('session-lock', 'requesting compositor session lock');
        this.#lock.lock();
    }

    /** Release the session lock. */
    unlock() {
        if (!this.isLocked) return;
        logger.info('session-lock', 'unlocking authenticated session');
        this.#lock!.unlock();
    }

    /**
     * Assign a window to a monitor in the locked session.
     * Called during widget layout — the widget passes its window
     * and monitor, the service handles the protocol call.
     */
    assignWindow(window: Gtk.Window, monitor: Gdk.Monitor) {
        this.#lock?.assign_window_to_monitor(window, monitor);
    }
}
