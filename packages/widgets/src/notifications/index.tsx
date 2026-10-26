import Notifd from 'gi://AstalNotifd';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {DismissTimers} from '@shade/services/notifications/dismissTimers';
import DndService from '@shade/services/notifications/dnd';
import {getExpireMs} from '@shade/services/notifications/expire';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {bind, computed, createState, effect, For, onCleanup} from 'gnim';
import Notification from '../common/notification';
import PopupWindow from '../common/PopupWindow';

/** Max toasts visible simultaneously; older ones go to the QS list. */
const POPUP_CAP = 3;

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

/**
 * Anchor toasts to the corner next to the bar. Anchoring to a full edge
 * stretches the layer surface across the screen and swallows clicks.
 */
function cornerAnchor(position: number): number {
    if (position === BOTTOM) return BOTTOM | RIGHT;
    if (position === LEFT) return TOP | LEFT;
    return TOP | RIGHT;
}

const NotificationContent = ({
    notifd,
    setNotificationCount,
    showProgress,
}: {
    notifd: Notifd.Notifd;
    setNotificationCount: (n: number) => void;
    showProgress: boolean;
}) => {
    const [notifications, setNotifications] = createState<Notifd.Notification[]>([]);

    // Count bookkeeping lives in one reactive place.
    effect(() => {
        setNotificationCount(notifications().length);
    });

    function removeNotif(id: number) {
        timers.cancel(id);
        setNotifications((prev) => prev.filter((x) => x.id !== id));
    }

    const timers = new DismissTimers(removeNotif);

    const addNotification = (id: number) => {
        timers.cancel(id);
        const n = notifd.get_notification(id);
        if (!n) return;
        setNotifications((prev) => {
            // De-duplicate by id (notified can fire for updates).
            const filtered = prev.filter((x) => x.id !== id);
            const next = filtered.concat(n);
            // Keep only the newest POPUP_CAP visible as toasts.
            for (const evicted of next.slice(0, -POPUP_CAP)) {
                timers.cancel(evicted.id);
            }
            return next.slice(-POPUP_CAP);
        });
        // Critical notifications never auto-dismiss.
        if (n.urgency !== Notifd.Urgency.CRITICAL) {
            timers.schedule(id, getExpireMs(n, notifd));
        }
    };

    const resumeDismiss = (id: number) => {
        const current = notifications().find((n) => n.id === id);
        if (!current || current.urgency === Notifd.Urgency.CRITICAL) {
            timers.cancel(id);
            return;
        }
        timers.resume(id, getExpireMs(current, notifd));
    };

    const invokeDefault = (n: Notifd.Notification) => () => {
        n.invoke('default');
        removeNotif(n.id);
    };

    return (
        <Gtk.Box
            spacing={8}
            orientation={Gtk.Orientation.VERTICAL}
            ref={(_self) => {
                const node = {};
                connectFor(node, notifd, 'notified', (_, id) => addNotification(id as number));
                connectFor(node, notifd, 'resolved', (_, id) => removeNotif(id as number));
                onCleanup(() => {
                    cleanupNode(node);
                    timers.clear();
                });
            }}
        >
            <For each={notifications}>
                {(n: Notifd.Notification) => (
                    <Notification
                        notification={n}
                        variant="popup"
                        closeAction={(_notif, _card) => removeNotif(n.id)}
                        pauseDismiss={() => timers.pause(n.id)}
                        resumeDismiss={() => resumeDismiss(n.id)}
                        showProgress={showProgress}
                        onDefaultAction={invokeDefault(n)}
                        onActionInvoked={() => removeNotif(n.id)}
                    />
                )}
            </For>
        </Gtk.Box>
    );
};

export default () => {
    const notifd = useNotifd();
    const [notificationCount, setNotificationCount] = createState(0);
    const dontDisturb = bind(DndService.get_default(), 'dnd');
    const settings = generalSettings();
    const showProgress = settings.notificationShowProgress();
    const screenlocked = bind(ShellState.get_default(), 'screenlocked');

    return (
        <PopupWindow
            name="notifications"
            margin={12}
            anchor={barSettings().position.as(cornerAnchor)}
            visible={computed(
                () =>
                    notifd() !== null &&
                    notificationCount() > 0 &&
                    !dontDisturb() &&
                    !screenlocked()
            )}
            ref={(self) => WindowManager.get_default().setNotifications(self)}
        >
            {/* Singleton-array For defers child evaluation until notifd is non-null. */}
            <For each={notifd.as((n) => (n ? [n] : []))}>
                {(n: Notifd.Notifd) => (
                    <NotificationContent
                        notifd={n}
                        setNotificationCount={setNotificationCount}
                        showProgress={showProgress}
                    />
                )}
            </For>
        </PopupWindow>
    );
};
