import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {For, createState, effect, onCleanup} from 'gnim';
import Notification from '../common/notification';
import {useNotifd} from '../../lib/services/notifications/useNotifd';
import {isNotifdResolved} from '../../lib/services/notifications/guard';
import {connectFor, cleanupNode} from '../../lib/core/connectFor';
import logger from '../../lib/core/logger';

/**
 * LockscreenNotifications — displays active notifications on the lockscreen.
 *
 * Design goals:
 * - Show notifications that arrive while the screen is locked.
 * - No auto-dismiss (user may be away); notifications persist until dismissed.
 * - Reuses the shared `Notification` card component for visual consistency.
 * - Capped to MAX_NOTIFICATIONS to prevent unbounded growth (overflow handling).
 * - Non-interactive actions are hidden on the lockscreen for security
 *   (a close button is provided so the user can clear them).
 */

const MAX_NOTIFICATIONS = 20;

const LockscreenContent = ({notifd}: {notifd: Notifd.Notifd}) => {
    const [notifications, setNotifications] = createState<
        Notifd.Notification[]
    >([]);

    const addNotification = (id: number) => {
        const n = notifd.get_notification(id);
        if (!n) return;

        setNotifications(prev => {
            // De-duplicate by id (notified can fire for updates to existing notifs)
            const filtered = prev.filter(x => x.id !== id);
            const next = [n, ...filtered];
            // Cap to prevent unbounded growth on the lockscreen
            return next.slice(0, MAX_NOTIFICATIONS);
        });
    };

    const closeAction = (notif: Notifd.Notification) => {
        try {
            notif.dismiss();
        } catch (e) {
            logger.warn('lockscreen', 'failed to dismiss notification:', e);
        }
        setNotifications(prev => prev.filter(x => x.id !== notif.id));
    };

    return (
        <Gtk.ScrolledWindow
            visible={notifications.as(n => n.length > 0)}
            propagateNaturalHeight
            maxContentHeight={300}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            cssClasses={['card']}
            ref={_self => {
                // Seed with currently-active notifications (some may have
                // arrived before the screen locked)
                try {
                    const active = notifd.get_notifications();
                    if (active && active.length > 0) {
                        setNotifications(
                            active.slice(0, MAX_NOTIFICATIONS).reverse()
                        );
                    }
                } catch (e) {
                    logger.warn('lockscreen', 'failed to seed notifications:', e);
                }

                const node = {};
                connectFor(node, notifd, 'notified', (_, id) =>
                    addNotification(id)
                );
                connectFor(node, notifd, 'dismissed', (_, id) =>
                    setNotifications(prev => prev.filter(x => x.id !== id))
                );
                onCleanup(() => cleanupNode(node));
            }}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
            >
                <For each={notifications}>
                    {(n: Notifd.Notification) => (
                        <Notification
                            notification={n}
                            closeAction={closeAction}
                            showProgress={false}
                        />
                    )}
                </For>
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
};

export const LockscreenNotifications = () => {
    const notifd = useNotifd();

    effect(() => {
        if (isNotifdResolved() && notifd() === null) {
            logger.warn(
                'lockscreen',
                'Notifd unavailable — no notifications on lockscreen'
            );
        }
    });

    return (
        <For each={notifd.as(n => (n ? [n] : []))}>
            {(n: Notifd.Notifd) => <LockscreenContent notifd={n} />}
        </For>
    );
};
