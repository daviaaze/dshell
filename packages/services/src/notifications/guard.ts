import Notifd from 'gi://AstalNotifd';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib?version=2.0';
import {DeferredSingleton} from '@shade/core/deferredSingleton';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';

const NOTIF_BUS_NAME = 'org.freedesktop.Notifications';
const NOTIF_OBJECT_PATH = '/org/freedesktop/Notifications';
const NOTIF_IFACE = 'org.freedesktop.Notifications';

let _canInit: boolean | null = null;

/**
 * Check whether a foreign notification daemon is already running.
 * Result is cached so concurrent callers don't do redundant D-Bus round-trips.
 */
export function canInitNotifd(): boolean {
    if (_canInit !== null) return _canInit;
    _canInit = checkNotifdDaemon();
    return _canInit;
}

function checkNotifdDaemon(): boolean {
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

        const ownerResult = bus.call_sync(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'NameHasOwner',
            new GLib.Variant('(s)', [NOTIF_BUS_NAME]),
            null,
            Gio.DBusCallFlags.NONE,
            200,
            null
        );

        if (!ownerResult) return true;
        const [hasOwner] = ownerResult.deepUnpack() as [boolean];
        if (!hasOwner) return true;

        try {
            const infoResult = bus.call_sync(
                NOTIF_BUS_NAME,
                NOTIF_OBJECT_PATH,
                NOTIF_IFACE,
                'GetServerInformation',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                500,
                null
            );

            if (infoResult) {
                const unpacked = infoResult.deepUnpack() as [string, string, string, string];
                const [name, vendor] = unpacked;
                if (vendor === 'astal') return true;
                logger.warn(
                    'notifd',
                    `Foreign notification daemon "${name}" (${vendor}) detected. ` +
                        `Skipping AstalNotifd initialization.`
                );
                return false;
            }
        } catch {
            logger.debug(
                'notifd',
                `Notification daemon at ${NOTIF_BUS_NAME} did not respond. Proceeding.`
            );
            return true;
        }

        return false;
    } catch (e) {
        logger.warn(`${e}`);
        return true;
    }
}

// ── Singleton ──

const notifdSingleton = new DeferredSingleton<Notifd.Notifd>(
    () => {
        if (!canInitNotifd()) {
            watchForeignDaemon();
            throw new Error('Foreign notification daemon detected');
        }
        const daemon = Notifd.get_default();
        // Toast expiry is local presentation; unresolved notifications remain
        // available in the notification center until explicitly dismissed.
        daemon.set_ignore_timeout(true);
        return daemon;
    },
    (e) => logger.error('notifd', 'get_default() failed:', e)
);

/**
 * Safe wrapper around Notifd.get_default() that avoids the 25s D-Bus block.
 * Returns null if a foreign/unresponsive notification daemon is detected.
 *
 * Pre-initialized in widget/index.tsx services-init phase before any widget
 * mounts, so all subsequent callers hit the cache.
 */
export function getNotifdSafe(): Notifd.Notifd | null {
    return notifdSingleton.get();
}

/**
 * Whether the singleton has been resolved (instance or failure).
 * Widgets should check this before calling getNotifdSafe() synchronously —
 * an unresolved get() runs the factory inline and can block on D-Bus.
 */
export function isNotifdResolved(): boolean {
    return notifdSingleton.initialized;
}

let foreignDaemonWatch = 0;
const recoveryListeners = new Set<() => void>();

/** Subscribe to AstalNotifd becoming available after startup found a foreign daemon. */
export function onNotifdRecovered(cb: () => void): () => void {
    recoveryListeners.add(cb);
    return () => {
        recoveryListeners.delete(cb);
    };
}

/**
 * The ownership check is cached, so without this a foreign daemon seen at
 * startup would block notifications until the shell restarts. Watch its bus
 * name; when it leaves, run the check again and tell the subscribers.
 */
function watchForeignDaemon(): void {
    if (foreignDaemonWatch) return;
    foreignDaemonWatch = Gio.bus_watch_name(
        Gio.BusType.SESSION,
        NOTIF_BUS_NAME,
        Gio.BusNameWatcherFlags.NONE,
        null,
        () => {
            if (!notifdSingleton.initialized || notifdSingleton.get() !== null) return;
            _canInit = null;
            notifdSingleton.reset();
            if (!notifdSingleton.get()) return;
            logger.info('notifd', 'Foreign notification daemon is gone; AstalNotifd initialized');
            for (const cb of recoveryListeners) cb();
        }
    );
}

/**
 * One-shot watchdog: warns if notifd init hasn't completed within 15s.
 * Lives here (not the widget layer) so widgets stay event-driven.
 */
export function watchNotifdInit(isDone: () => boolean): void {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
        if (!isDone()) {
            logger.warn(
                'notifd',
                'Notifd.get_default() has not completed after 15s — D-Bus handshake may be hung. Notifications widget will not show.'
            );
        }
        return GLib.SOURCE_REMOVE;
    });
}

defineService({name: 'Notifd (pre-init)', service: {init: () => getNotifdSafe()}});
