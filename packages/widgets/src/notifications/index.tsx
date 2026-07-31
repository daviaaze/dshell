import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {For, bind, createState, effect, onCleanup} from 'gnim';
import Notification from '../common/notification';
import PopupWindow from '../common/PopupWindow';
import WindowManager from '@shade/services/state/windowManager';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {getExpireMs} from '@shade/services/notifications/expire';
import {DismissTimers} from '@shade/services/notifications/dismissTimers';
import {generalSettings} from '@shade/core/settings/general.gschema';
import ShellState from '@shade/services/state/shellState';
import DndService from '@shade/services/notifications/dnd';
import {connectFor, cleanupNode} from '@shade/core/connectFor';

/** Max toasts visible simultaneously; older ones go to the QS list. */
const POPUP_CAP = 3;

const NotificationContent = ({
    notifd,
    setNotificationCount,
    showProgress,
}: {
    notifd: Notifd.Notifd;
    setNotificationCount: (n: number) => void;
    showProgress: boolean;
}) => {
    const [notifications, setNotifications] = createState<
        Notifd.Notification[]
    >([]);

    // Count bookkeeping lives in one reactive place.
    effect(() => {
        setNotificationCount(notifications().length);
    });

    function removeNotif(id: number) {
        timers.cancel(id);
        setNotifications(prev => prev.filter(x => x.id !== id));
    }

    const timers = new DismissTimers(removeNotif);

    const addNotification = (id: number) => {
        const n = notifd.get_notification(id);
        if (!n) return;
        setNotifications(prev => {
            // De-duplicate by id (notified can fire for updates).
            const filtered = prev.filter(x => x.id !== id);
            const next = filtered.concat(n);
            // Keep only the newest POPUP_CAP visible as toasts.
            return next.slice(-POPUP_CAP);
        });
        // Critical notifications never auto-dismiss.
        if (n.urgency !== Notifd.Urgency.CRITICAL) {
            timers.schedule(id, getExpireMs(n, notifd));
        }
    };

    const invokeDefault = (n: Notifd.Notification) => () => {
        n.invoke('default');
        removeNotif(n.id);
    };

    return (
        <Gtk.Box
            spacing={8}
            orientation={Gtk.Orientation.VERTICAL}
            ref={_self => {
                const node = {};
                connectFor(node, notifd, 'notified', (_, id) =>
                    addNotification(id)
                );
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
                        resumeDismiss={() =>
                            timers.resume(n.id, getExpireMs(n, notifd))
                        }
                        showProgress={showProgress}
                        onDefaultAction={invokeDefault(n)}
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
            visible={
                notifd() !== null &&
                notificationCount() > 0 &&
                !dontDisturb() &&
                !screenlocked()
            }
            ref={self => WindowManager.get_default().setNotifications(self)}
        >
            {/* Singleton-array For defers child evaluation until notifd is non-null. */}
            <For each={notifd.as(n => (n ? [n] : []))}>
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
