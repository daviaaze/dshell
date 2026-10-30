import Adw from 'gi://Adw?version=1';
import type Notifd from 'gi://AstalNotifd';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {bus} from '@shade/services/bus';
import DndService from '@shade/services/notifications/dnd';
import type {HistoryEntry} from '@shade/services/notifications/history';
import NotificationHistory from '@shade/services/notifications/history';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {bind, createState, For} from 'gnim';
import Notification from '../common/notification';

const HISTORY_VISIBLE_COUNT = 20;

/** Notifications sorted newest-first. Does not mutate the input array. */
function newestFirst(notifications: Notifd.Notification[]): Notifd.Notification[] {
    return [...notifications].sort((a, b) => b.time - a.time);
}

/**
 * App names ordered by each app's most recent notification. Strings are
 * stable keys for `For`, so a dismissal only updates the affected group
 * instead of rebuilding every group (which froze the shell on "dismiss all").
 */
function appOrder(notifications: Notifd.Notification[]): string[] {
    return [...new Set(newestFirst(notifications).map((n) => n.appName))];
}

/** Dismiss notifications from an idle callback (avoids mutating during signal emission). */
function dismissAll(notifications: Notifd.Notification[]): void {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        for (const n of notifications) n.dismiss();
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Short timestamp for history rows:
 *   today         -> "14:30"
 *   this week     -> "Mon 14:30"
 *   otherwise     -> "12 Mar"
 */
function historyTime(unix: number): string {
    const dt = GLib.DateTime.new_from_unix_local(unix)!;
    const now = GLib.DateTime.new_now_local()!;
    const startOfDay = GLib.DateTime.new_local(
        now.get_year(),
        now.get_month(),
        now.get_day_of_month(),
        0,
        0,
        0
    )!;
    // Compare via unix timestamps to avoid add_days nullability noise.
    const startOfDayUnix = startOfDay.to_unix();
    const weekStartUnix = startOfDayUnix - (startOfDay.get_day_of_week() - 1) * 86400;
    const dtUnix = dt.to_unix();
    if (dtUnix >= startOfDayUnix) {
        return dt.format('%H:%M') || '';
    }
    if (dtUnix >= weekStartUnix) {
        return dt.format('%a %H:%M') || '';
    }
    return dt.format('%d %b') || '';
}

/**
 * Inner content component — only mounted once Notifd is initialized.
 * Avoids the 25s D-Bus proxy timeout when another notification daemon
 * (dunst, mako, etc.) is already registered on the session bus.
 */
const NotificationListContent = ({
    notifd,
    history,
    showHistory,
    setShowHistory,
    showProgress,
}: {
    notifd: Notifd.Notifd;
    history: NotificationHistory;
    showHistory: ReturnType<typeof createState<boolean>>[0];
    setShowHistory: ReturnType<typeof createState<boolean>>[1];
    showProgress: boolean;
}) => {
    const dnd = DndService.get_default();

    const Header = () => (
        <Gtk.Box cssClasses={['toolbar']}>
            <Gtk.Label
                label={showHistory.as((h) => (h ? 'History' : 'Notifications'))}
                cssClasses={['title-1']}
                hexpand
            />
            <Gtk.Button
                cssClasses={['flat']}
                iconName={showHistory.as((h) =>
                    h ? 'go-previous-symbolic' : 'document-open-recent-symbolic'
                )}
                onClicked={() => setShowHistory(!showHistory())}
                tooltipText={showHistory.as((h) => (h ? 'Back to notifications' : 'View history'))}
            />
            <Gtk.Button
                cssClasses={['flat']}
                iconName={'edit-clear-all-symbolic'}
                tooltipText={'Dismiss all active notifications'}
                onClicked={() => dismissAll(notifd.get_notifications())}
                ref={(self) =>
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [new GObject.Value(GObject.TYPE_STRING, 'Dismiss all active notifications')]
                    )
                }
            />
            <Gtk.ToggleButton
                onClicked={(self) => bus.emit('system:dnd:set', self.active)}
                active={bind(dnd, 'dnd')}
                cursor={Gdk.Cursor.new_from_name('pointer', null)}
                iconName={bind(dnd, 'dnd').as((enabled) =>
                    enabled ? 'notifications-disabled-symbolic' : 'notifications-symbolic'
                )}
                tooltipText={bind(dnd, 'dnd').as((enabled) =>
                    enabled ? 'Do Not Disturb on' : 'Do Not Disturb off'
                )}
                cssClasses={bind(dnd, 'dnd').as((enabled) =>
                    enabled ? ['suggested-action', 'warning'] : ['flat']
                )}
                ref={(self) =>
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [new GObject.Value(GObject.TYPE_STRING, 'Do Not Disturb')]
                    )
                }
            />
        </Gtk.Box>
    );

    const HistoryView = () => (
        <Gtk.Box visible={showHistory} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <Gtk.ListBox
                cssClasses={['boxed-list']}
                visible={bind(history, 'history').as((h) => h.length > 0)}
                selectionMode={Gtk.SelectionMode.NONE}
            >
                <For each={bind(history, 'history').as((h) => h.slice(0, HISTORY_VISIBLE_COUNT))}>
                    {(entry: HistoryEntry) => <HistoryItem entry={entry} />}
                </For>
            </Gtk.ListBox>
            <Gtk.Label
                visible={bind(history, 'history').as((h) => h.length > HISTORY_VISIBLE_COUNT)}
                cssClasses={['caption', 'dimmed']}
                label={bind(history, 'history').as(
                    (h) => `Showing ${HISTORY_VISIBLE_COUNT} of ${h.length} notifications`
                )}
                halign={Gtk.Align.CENTER}
            />
            <Adw.StatusPage
                visible={bind(history, 'history').as((h) => h.length === 0)}
                vexpand
                cssClasses={['compact']}
                title="No history"
                description="Notification history is empty"
                iconName="notification-symbolic"
            />
        </Gtk.Box>
    );

    const HistoryItem = ({entry}: {entry: HistoryEntry}) => {
        return (
            <Adw.ActionRow
                title={entry.summary}
                subtitle={`${entry.appName} — ${entry.body || ''}`}
                subtitleLines={1}
                marginBottom={4}
            >
                <Gtk.Label
                    cssClasses={['caption', 'numeric']}
                    label={historyTime(entry.time)}
                    valign={Gtk.Align.CENTER}
                    slot="prefix"
                />
                <Gtk.Image
                    pixelSize={24}
                    iconName={entry.appIcon || 'dialog-information-symbolic'}
                    valign={Gtk.Align.CENTER}
                    slot="prefix"
                />
                <Gtk.Button
                    cssClasses={['flat', 'circular']}
                    iconName={'edit-delete-symbolic'}
                    valign={Gtk.Align.CENTER}
                    tooltipText={'Delete from history'}
                    onClicked={() => history.remove(entry.id)}
                    slot="suffix"
                    ref={(self) =>
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Delete from history')]
                        )
                    }
                />
            </Adw.ActionRow>
        );
    };

    const NotificationGroup = ({appName}: {appName: string}) => {
        const [visible, setVisible] = createState(false);
        const notifications = bind(notifd, 'notifications').as((ns) =>
            newestFirst(ns.filter((n) => n.appName === appName))
        );
        const first = notifications.as((ns) => ns.slice(0, 1));
        const rest = notifications.as((ns) => ns.slice(1));

        const Heading = () => (
            <Gtk.Box cssClasses={['toolbar']} visible={notifications.as((ns) => ns.length > 1)}>
                <Gtk.ToggleButton
                    onClicked={() => setVisible(!visible())}
                    active={visible}
                    cssClasses={['flat']}
                >
                    <Gtk.Box>
                        <Gtk.Image iconName={notifications.as((ns) => ns[0]?.appIcon ?? '')} />
                        <Gtk.Label label={appName} hexpand cssClasses={['caption-heading']} />
                        <Gtk.Image
                            iconName={visible.as((v) =>
                                v ? 'go-up-symbolic' : 'go-down-symbolic'
                            )}
                        />
                    </Gtk.Box>
                </Gtk.ToggleButton>
                <Gtk.Button
                    iconName={'edit-clear-all-symbolic'}
                    valign={Gtk.Align.END}
                    tooltipText={'Dismiss this group'}
                    cssClasses={['flat']}
                    onClicked={() => dismissAll(notifications())}
                    ref={(self) =>
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Dismiss this group')]
                        )
                    }
                />
            </Gtk.Box>
        );

        const Item = ({notif}: {notif: Notifd.Notification}) => (
            <Notification
                notification={notif}
                variant="list"
                showProgress={showProgress}
                closeAction={(n) => dismissAll([n])}
            />
        );

        return (
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <Heading />
                <For each={first}>{(notif: Notifd.Notification) => <Item notif={notif} />}</For>
                <Gtk.Revealer revealChild={visible}>
                    <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                        <For each={rest}>
                            {(notif: Notifd.Notification) => <Item notif={notif} />}
                        </For>
                    </Gtk.Box>
                </Gtk.Revealer>
            </Gtk.Box>
        );
    };

    const ActiveView = () => (
        <Gtk.Box
            visible={showHistory.as((v) => !v)}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={6}
        >
            <For each={bind(notifd, 'notifications').as(appOrder)}>
                {(appName: string) => <NotificationGroup appName={appName} />}
            </For>
            <Adw.StatusPage
                visible={bind(notifd, 'notifications').as((n) => n.length < 1)}
                vexpand
                cssClasses={['compact']}
                title={'No new notifications'}
                description={"You're up-to-date"}
                iconName={'notification-symbolic'}
            />
        </Gtk.Box>
    );

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <Header />
            <HistoryView />
            <ActiveView />
        </Gtk.Box>
    );
};

export const NotificationList = () => {
    const notifd = useNotifd();
    const history = NotificationHistory.get_default();
    const [showHistory, setShowHistory] = createState(false);
    const settings = generalSettings();
    const showProgress = settings.notificationShowProgress();

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            {/* Loading placeholder shown until Notifd is ready */}
            <Gtk.Box
                visible={notifd.as((n) => n === null)}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={12}
                valign={Gtk.Align.CENTER}
                halign={Gtk.Align.CENTER}
                vexpand
            >
                <Gtk.Spinner spinning cssClasses={['suggested-action']} />
                <Gtk.Label cssClasses={['caption']} label="Loading notifications…" />
            </Gtk.Box>
            {/* Singleton-array For defers child evaluation until notifd is
                non-null (gnim does not support nested For inside With). */}
            <For each={notifd.as((n) => (n ? [n] : []))}>
                {(n: Notifd.Notifd) => (
                    <NotificationListContent
                        notifd={n}
                        history={history}
                        showHistory={showHistory}
                        setShowHistory={setShowHistory}
                        showProgress={showProgress}
                    />
                )}
            </For>
        </Gtk.Box>
    );
};
