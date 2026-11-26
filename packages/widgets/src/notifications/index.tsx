import Astal from 'gi://Astal?version=4.0';
import type Notifd from 'gi://AstalNotifd';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {cleanupNode, connectFor} from '@shade/core/connectFor';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {getHyprland} from '@shade/services/hyprland';
import {monitors as nativeMonitors} from '@shade/services/monitoring/monitors';
import {DismissTimers} from '@shade/services/notifications/dismissTimers';
import DndService from '@shade/services/notifications/dnd';
import {getExpireMs} from '@shade/services/notifications/expire';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import ShellState from '@shade/services/state/shellState';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, computed, createState, effect, For, onCleanup} from 'gnim';
import Notification from '../common/notification';
import {
    NOTIFICATION_TOAST_SPACING,
    notificationToastCardHeight,
    notificationToastWindowHeight,
    notificationUrgency,
    ToastCountdown,
    upsertToast,
} from '../common/notificationModel';
import PopupWindow from '../common/PopupWindow';

/** Criticals are pinned against ordinary chatter; overflow remains in the center. */
const POPUP_CAP = 3;
const monotonicMs = () => GLib.get_monotonic_time() / 1000;

const NotificationContent = ({
    notifd,
    setNotificationCount,
    showProgress,
    monitorHeight,
    onLayoutChanged,
}: {
    notifd: Notifd.Notifd;
    setNotificationCount: (n: number) => void;
    showProgress: boolean;
    monitorHeight: Accessor<number>;
    onLayoutChanged: () => void;
}) => {
    const [notifications, setNotifications] = createState<Notifd.Notification[]>([]);
    const countdowns = new Map<number, ToastCountdown>();
    const hovered = new Set<number>();
    const cardMaxHeight = computed(() =>
        notificationToastCardHeight(monitorHeight(), notifications().length)
    );

    effect(() => {
        setNotificationCount(notifications().length);
        onLayoutChanged();
    });

    function removeNotif(id: number) {
        timers.cancel(id);
        countdowns.delete(id);
        hovered.delete(id);
        setNotifications((previous) => previous.filter((notification) => notification.id !== id));
    }

    const timers = new DismissTimers(removeNotif);

    const addNotification = (id: number) => {
        const notification = notifd.get_notification(id);
        if (!notification) return;
        const previous = notifications();
        const next = upsertToast(previous, notification, POPUP_CAP);
        for (const old of previous) {
            if (next.some((item) => item.id === old.id)) continue;
            timers.cancel(old.id);
            countdowns.delete(old.id);
            hovered.delete(old.id);
        }
        setNotifications(next);
        if (!next.some((item) => item.id === id)) return;
        if (!notificationUrgency(notification.urgency).autoDismiss) {
            timers.cancel(id);
            countdowns.delete(id);
        } else if (!countdowns.has(id)) {
            // Same-id content updates retain both lifetime and interaction state.
            const countdown = new ToastCountdown(getExpireMs(notification, notifd), monotonicMs());
            countdowns.set(id, countdown);
            if (hovered.has(id)) countdown.pause(monotonicMs());
            else timers.schedule(id, Math.ceil(countdown.remaining(monotonicMs())));
        }
    };

    const pauseDismiss = (id: number) => {
        hovered.add(id);
        countdowns.get(id)?.pause(monotonicMs());
        timers.pause(id);
    };

    const resumeDismiss = (id: number) => {
        hovered.delete(id);
        const countdown = countdowns.get(id);
        if (!countdown) return;
        const now = monotonicMs();
        countdown.resume(now);
        timers.resume(id, Math.ceil(countdown.remaining(now)));
    };

    return (
        <Gtk.Box
            spacing={NOTIFICATION_TOAST_SPACING}
            orientation={Gtk.Orientation.VERTICAL}
            ref={() => {
                const node = {};
                connectFor(node, notifd, 'notified', (_, id) => addNotification(id as number));
                connectFor(node, notifd, 'resolved', (_, id) => removeNotif(id as number));
                onCleanup(() => {
                    cleanupNode(node);
                    timers.clear();
                    countdowns.clear();
                    hovered.clear();
                    setNotificationCount(0);
                });
            }}
        >
            {/* Stable id keys retain the card, hover controllers and progress on replacement. */}
            <For each={notifications.as((items) => items.map((notification) => notification.id))}>
                {(id: number) => {
                    const initial = notifd.get_notification(id)!;
                    const notification = computed(
                        () => notifications().find((item) => item.id === id) ?? initial
                    );
                    return (
                        <Notification
                            notification={notification}
                            variant="popup"
                            maxHeight={cardMaxHeight}
                            closeAction={() => removeNotif(id)}
                            pauseDismiss={() => pauseDismiss(id)}
                            resumeDismiss={() => resumeDismiss(id)}
                            showProgress={showProgress}
                            progress={() => countdowns.get(id)?.fraction(monotonicMs()) ?? 1}
                            onDefaultAction={() => {
                                notification().invoke('default');
                                removeNotif(id);
                            }}
                            onActionInvoked={() => removeNotif(id)}
                        />
                    );
                }}
            </For>
        </Gtk.Box>
    );
};

export default () => {
    const {value: notifd} = useNotifd();
    const [notificationCount, setNotificationCount] = createState(0);
    const dontDisturb = bind(DndService.get_default(), 'dnd');
    const settings = generalSettings();
    const showProgress = settings.notificationShowProgress();
    const shellState = ShellState.get_default();
    const screenlocked = bind(shellState, 'screenlocked');
    const centerOpen = bind(shellState, 'notificationsOpen');
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const monitor = bind(hyprland, 'focused-monitor');
    const windowMonitor = computed(() => monitorIndexFromHyprland(monitor()));
    const nativeMonitor = computed(() => nativeMonitors()[windowMonitor()] ?? null);
    const [monitorHeight, setMonitorHeight] = createState(0);
    let popupWidget: Astal.Window | undefined;
    let resizeSource = 0;
    let alive = true;
    const scheduleResize = () => {
        if (!alive || resizeSource) return;
        resizeSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            resizeSource = 0;
            const child = popupWidget?.get_child();
            if (!alive || !popupWidget || !child || monitorHeight() <= 0) {
                return GLib.SOURCE_REMOVE;
            }
            const naturalWidth = child.measure(Gtk.Orientation.HORIZONTAL, -1)[1];
            const naturalHeight = child.measure(
                Gtk.Orientation.VERTICAL,
                Math.max(1, naturalWidth)
            )[1];
            // A prior short stack must not keep later actions below the fold.
            // The per-card scrollers still handle genuinely overflowing content.
            popupWidget.set_default_size(
                -1,
                notificationToastWindowHeight(monitorHeight(), naturalHeight)
            );
            return GLib.SOURCE_REMOVE;
        });
    };
    effect(() => {
        const current = nativeMonitor();
        if (!current) return;
        const updateGeometry = () => {
            setMonitorHeight(current.get_geometry().height);
            scheduleResize();
        };
        updateGeometry();
        const signals = (['notify::geometry', 'notify::scale-factor'] as const)
            .map((signal) => current.connect(signal, updateGeometry));
        onCleanup(() => {
            for (const signal of signals) current.disconnect(signal);
        });
    });

    return (
        <PopupWindow
            name="notifications"
            margin={4}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.NONE}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
            monitor={windowMonitor}
            visible={computed(
                () =>
                    notifd() !== null &&
                    notificationCount() > 0 &&
                    monitorHeight() > 0 &&
                    !dontDisturb() &&
                    !screenlocked() &&
                    !centerOpen()
            )}
            ref={(self) => {
                popupWidget = self;
                const mapped = self.connect('map', scheduleResize);
                scheduleResize();
                onCleanup(() => {
                    alive = false;
                    if (resizeSource) GLib.source_remove(resizeSource);
                    self.disconnect(mapped);
                });
            }}
        >
            <For each={notifd.as((daemon) => daemon ? [daemon] : [])}>
                {(daemon: Notifd.Notifd) => (
                    <NotificationContent
                        notifd={daemon}
                        setNotificationCount={setNotificationCount}
                        monitorHeight={monitorHeight}
                        onLayoutChanged={scheduleResize}
                        showProgress={showProgress}
                    />
                )}
            </For>
        </PopupWindow>
    );
};
