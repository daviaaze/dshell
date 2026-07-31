import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {For, bind, createState, computed, effect, onCleanup} from 'gnim';
import Notification from '../common/notification';
import PopupWindow from '../common/PopupWindow';
import WindowManager from '@shade/services/state/windowManager';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {getExpireMs} from '@shade/services/notifications/expire';
import {DismissTimers} from '@shade/services/notifications/dismissTimers';
import {useSettings} from '@shade/services/settings/index';
import ShellState from '@shade/services/state/shellState';
import DndService from '@shade/services/notifications/dnd';
import {connectFor, cleanupNode} from '@shade/core/connectFor';

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

    // Count bookkeeping lives in one reactive place instead of being
    // repeated inside every state updater.
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
        setNotifications(prev => prev.concat(n));
        timers.schedule(id, getExpireMs(n, notifd));
    };

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            ref={() => {
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
            <For each={notifications.as(n => [...n].reverse())}>
                {(n: Notifd.Notification) => (
                    <Notification
                        closeAction={() => removeNotif(n.id)}
                        pauseDismiss={() => timers.pause(n.id)}
                        resumeDismiss={() =>
                            timers.resume(n.id, getExpireMs(n, notifd))
                        }
                        showProgress={showProgress}
                        notification={n}
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
    const settings = useSettings().general;
    const showProgress = settings.notificationShowProgress();
    const screenlocked = bind(ShellState.get_default(), 'screenlocked');

    return (
        <PopupWindow
            name="notifications"
            margin={12}
            visible={computed(
                () =>
                    notifd() !== null &&
                    notificationCount() > 0 &&
                    !dontDisturb() &&
                    !screenlocked()
            )}
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
