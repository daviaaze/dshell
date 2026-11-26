import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import SessionLock from 'gi://Gtk4SessionLock';
import logger from '@shade/core/logger';
import {Object, register, signal} from 'gnim/gobject';

export interface SessionLockSignalSignatures extends Object.SignalSignatures {
    locked: SessionLockService['locked'];
    unlocked: SessionLockService['unlocked'];
    failed: SessionLockService['failed'];
    stalled: SessionLockService['stalled'];
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
    #confirmed = false;
    #requestTimeout = 0;
    #requestTimeoutMs: number;

    constructor(
        createLock: () => SessionLock.Instance = () => SessionLock.Instance.new(),
        requestTimeoutMs = 10_000
    ) {
        super();
        this.#createLock = createLock;
        this.#requestTimeoutMs = requestTimeoutMs;
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

    /** Acquisition is unanswered, but its native request and lock surfaces remain pending. */
    @signal
    stalled(): void {}

    /** Create an unrealized lock window for this output before mapping it. */
    @signal
    monitor(_monitor: Gdk.Monitor): void {}

    get isLocked(): boolean {
        return this.#lock?.is_locked() ?? false;
    }

    // ── Public API ──

    /** Request the session to be locked. */
    lock() {
        if (this.#requested || this.isLocked) return;
        this.#retireLock();
        let lock: SessionLock.Instance;
        try {
            lock = this.#createLock();
        } catch (error) {
            logger.error('session-lock', 'could not create session lock:', error);
            this.failed();
            return;
        }
        this.#lock = lock;
        this.#requested = true;
        this.#signalIds = [
            lock.connect('monitor', (_lock, monitor: Gdk.Monitor) => {
                if (this.#lock === lock) this.monitor(monitor);
            }),
            lock.connect('locked', () => this.#confirmLock(lock)),
            lock.connect('failed', () => this.#failLock(lock, 'compositor rejected session lock')),
            lock.connect('unlocked', () => {
                if (this.#lock !== lock) return;
                this.#retireLock();
                this.unlocked();
            }),
        ];
        this.#requestTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this.#requestTimeoutMs,
            () => {
                this.#requestTimeout = 0;
                if (this.#lock !== lock) return GLib.SOURCE_REMOVE;
                if (lock.is_locked()) {
                    this.#confirmLock(lock);
                } else {
                    // Gtk4SessionLock cannot cancel a pending protocol request.
                    // Keep its native callback target alive and keep listening:
                    // a late reply must not acquire an unmanaged session lock.
                    logger.error(
                        'session-lock',
                        'compositor did not answer session lock request; still waiting'
                    );
                    this.stalled();
                }
                return GLib.SOURCE_REMOVE;
            }
        );
        logger.info('session-lock', 'requesting compositor session lock');
        try {
            if (!lock.lock()) this.#failLock(lock, 'session lock request failed immediately');
        } catch (error) {
            this.#failLock(lock, `session lock request failed: ${error}`);
        }
    }

    #cancelRequestTimeout(): void {
        if (this.#requestTimeout) GLib.Source.remove(this.#requestTimeout);
        this.#requestTimeout = 0;
    }

    #confirmLock(lock: SessionLock.Instance): void {
        if (this.#lock !== lock || this.#confirmed) return;
        this.#cancelRequestTimeout();
        this.#confirmed = true;
        logger.info('session-lock', 'compositor confirmed session lock');
        this.locked();
    }

    #failLock(lock: SessionLock.Instance, reason: string): void {
        if (this.#lock !== lock) return;
        // Never dispose or unlock an acquired lock because of a timeout/error.
        if (lock.is_locked()) {
            this.#confirmLock(lock);
            return;
        }
        logger.error('session-lock', reason);
        this.#retireLock();
        this.failed();
    }

    #retireLock(): void {
        this.#cancelRequestTimeout();
        const lock = this.#lock;
        this.#lock = null;
        this.#requested = false;
        this.#confirmed = false;
        if (!lock) return;
        for (const id of this.#signalIds) lock.disconnect(id);
        this.#signalIds = [];
        try {
            // Gtk4SessionLock has no destroy() API; retire its GObject resources.
            // This is only called after failure/unlock, never on an acquired lock.
            lock.run_dispose();
        } catch (error) {
            logger.warn('session-lock', 'could not dispose retired session lock:', error);
        }
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
