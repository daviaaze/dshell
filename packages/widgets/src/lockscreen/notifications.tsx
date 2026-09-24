import type Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import logger from '@shade/core/logger';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {isNotifdResolved} from '@shade/services/notifications/guard';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {createState, effect, For, onCleanup} from 'gnim';
import Notification from '../common/notification';

/**
 * LockscreenNotifications displays active notifications without revealing
 * content unless the user explicitly allows it in notification settings.
 * Redacted cards retain a generic presence label and dismissal control.
 */

const MAX_NOTIFICATIONS = 20;

const LockscreenContent = ({notifd}: {notifd: Notifd.Notifd}) => {
    const settings = generalSettings();
    const [showContent, setShowContent] = createState(settings.notificationLockscreenContent());
    const [notifications, setNotifications] = createState<Notifd.Notification[]>([]);

    const addNotification = (id: number) => {
        const n = notifd.get_notification(id);
        if (!n) return;

        setNotifications((prev) => {
            // De-duplicate by id (notified can fire for updates to existing notifs)
            const filtered = prev.filter((x) => x.id !== id);
            const next = [n, ...filtered];
            // Cap to prevent unbounded growth on the lockscreen
            return next.slice(0, MAX_NOTIFICATIONS);
        });
    };

    const removeNotification = (id: number) =>
        setNotifications((prev) => prev.filter((x) => x.id !== id));

    const closeAction = (notif: Notifd.Notification) => {
        try {
            notif.dismiss();
        } catch (e) {
            logger.warn('lockscreen', 'failed to dismiss notification:', e);
        }
        removeNotification(notif.id);
    };

    return (
        <Gtk.ScrolledWindow
            visible={notifications.as((n) => n.length > 0)}
            propagateNaturalHeight
            maxContentHeight={300}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            cssClasses={['card']}
            ref={(_self) => {
                // Seed with currently-active notifications (some may have
                // arrived before the screen locked)
                try {
                    const active = notifd.get_notifications();
                    if (active && active.length > 0) {
                        setNotifications(active.slice(0, MAX_NOTIFICATIONS).reverse());
                    }
                } catch (e) {
                    logger.warn('lockscreen', 'failed to seed notifications:', e);
                }

                const node = {};
                connectFor(node, settings.raw, 'changed', (_, key) => {
                    if (key === 'notification-lockscreen-content') {
                        setShowContent(settings.notificationLockscreenContent());
                    }
                });
                connectFor(node, notifd, 'notified', (_, id) => addNotification(id as number));
                connectFor(node, notifd, 'resolved', (_, id) => removeNotification(id as number));
                onCleanup(() => cleanupNode(node));
            }}
        >
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <For each={notifications}>
                    {(n: Notifd.Notification) =>
                        showContent() ? (
                            <Notification
                                notification={n}
                                variant="lockscreen"
                                closeAction={closeAction}
                                showProgress={false}
                                showActions={false}
                            />
                        ) : (
                            <Gtk.Box
                                cssClasses={['card']}
                                spacing={8}
                                halign={Gtk.Align.FILL}
                            >
                                <Gtk.Label
                                    label={'New notification'}
                                    hexpand
                                    halign={Gtk.Align.START}
                                />
                                <Gtk.Button
                                    label={'Dismiss'}
                                    onClicked={() => closeAction(n)}
                                />
                            </Gtk.Box>
                        )
                    }
                </For>
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
};

export const LockscreenNotifications = () => {
    const notifd = useNotifd();

    effect(() => {
        if (isNotifdResolved() && notifd() === null) {
            logger.warn('lockscreen', 'Notifd unavailable — no notifications on lockscreen');
        }
    });

    return (
        <For each={notifd.as((n) => (n ? [n] : []))}>
            {(n: Notifd.Notifd) => <LockscreenContent notifd={n} />}
        </For>
    );
};
