import GObject from 'gi://GObject?version=2.0';
import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {For, createState, effect, onCleanup} from 'gnim';
import {useStyle} from '#/style/useStyle';
import Notification from '#/widget/common/notification';
import {getNotifdSafe} from '#/lib/services/notifications/guard';
import logger from '#/lib/core/logger';

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

export const LockscreenNotifications = () => {
    const lockscreenStyle = useStyle({
        padding: '8px',
        background: 'var(--shade-bg)',
        'border-radius': '12px',
    });
    const listStyle = useStyle({
        spacing: '8px',
    });
    const [notifications, setNotifications] = createState<
        Notifd.Notification[]
    >([]);

    const addNotification = (id: number) => {
        const notifd = getNotifdSafe();
        if (!notifd) return;
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

    const removeNotification = (notif: Notifd.Notification) => {
        setNotifications(prev => prev.filter(x => x.id !== notif.id));
    };

    const closeAction = (notif: Notifd.Notification, _self: Gtk.Widget) => {
        try {
            notif.dismiss();
        } catch (e) {
            logger.warn('lockscreen', 'failed to dismiss notification:', e);
        }
        removeNotification(notif);
    };

    effect(() => {
        const notifd = getNotifdSafe();
        if (!notifd) {
            logger.warn(
                'lockscreen',
                'Notifd unavailable — no notifications on lockscreen'
            );
            return;
        }

        // Seed with currently-active notifications (in case some arrived before lock)
        try {
            const active = notifd.get_notifications();
            if (active && active.length > 0) {
                setNotifications(active.slice(0, MAX_NOTIFICATIONS).reverse());
            }
        } catch (e) {
            logger.warn('lockscreen', 'failed to seed notifications:', e);
        }

        const handlerId = notifd.connect('notified', (_, id: number) =>
            addNotification(id)
        );

        const dismissedId = GObject.signal_connect(notifd, 'dismissed', (_source: Notifd.Notifd, ...args: unknown[]) => {
            const id = args[0] as number;
            setNotifications(prev => prev.filter(x => x.id !== id));
        });

        onCleanup(() => {
            try {
                notifd.disconnect(handlerId);
            } catch {
                /* already gone */
            }
            try {
                notifd.disconnect(dismissedId);
            } catch {
                /* already gone */
            }
        });
    });

    return (
        <Gtk.ScrolledWindow
            visible={notifications.as(n => n.length > 0)}
            propagateNaturalHeight
            maxContentHeight={300}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            cssClasses={['lockscreen-notifications', lockscreenStyle.class]}
            ref={lockscreenStyle.$}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                cssClasses={['lockscreen-notifications-list', listStyle.class]}
                ref={listStyle.$}
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
