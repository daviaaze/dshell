import Notifd from 'gi://AstalNotifd';
import GLib from 'gi://GLib?version=2.0';
import {createState, effect, type Accessor} from 'gnim';
import {getNotifdSafe, isNotifdResolved, watchNotifdInit} from './guard';

/**
 * Reactive access to the AstalNotifd singleton.
 *
 * Returns an Accessor that is `null` while initializing, or permanently
 * `null` when a foreign notification daemon owns the bus name.
 *
 * Never blocks the main loop: if the singleton was already resolved
 * (services-init phase), the value is set synchronously; otherwise the
 * first D-Bus proxy construction is deferred to idle.
 *
 * Must be called inside a gnim reactive scope (component body).
 */
export function useNotifd(): Accessor<Notifd.Notifd | null> {
    const [notifd, setNotifd] = createState<Notifd.Notifd | null>(null);

    effect(() => {
        // Fast path: resolved during services-init (success or failure).
        if (isNotifdResolved()) {
            setNotifd(getNotifdSafe());
            return;
        }

        // Slow path: defer resolution so widget mount doesn't block
        // on the D-Bus proxy handshake (up to 25s with a foreign daemon).
        let done = false;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            done = true;
            setNotifd(getNotifdSafe());
            return GLib.SOURCE_REMOVE;
        });
        watchNotifdInit(() => done);
    });

    return notifd;
}
