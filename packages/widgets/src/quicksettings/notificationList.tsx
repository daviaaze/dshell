import Adw from 'gi://Adw?version=1';
import type Notifd from 'gi://AstalNotifd';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {bus} from '@shade/services/bus';
import DndService from '@shade/services/notifications/dnd';
import type {HistoryEntry} from '@shade/services/notifications/history';
import NotificationHistory from '@shade/services/notifications/history';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {useStyle} from '@shade/style/useStyle';
import {bind, createState, For} from 'gnim';
import Notification from '../common/notification';

const HISTORY_VISIBLE_COUNT = 20;

/**
 * Sort notifications newest-first and group them by app, preserving
 * the order in which each app's most recent notification appeared.
 * Does not mutate the input array.
 */
function groupByApp(notifications: Notifd.Notification[]): Notifd.Notification[][] {
    const groups: Notifd.Notification[][] = [];
    const sorted = [...notifications].sort((a, b) => b.time - a.time);
    for (const notif of sorted) {
        const group = groups.find((g) => g[0]!.appName === notif.appName);
        if (group) group.push(notif);
        else groups.push([notif]);
    }
    return groups;
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
                tooltipText={'Clear all notifications'}
                onClicked={() => dismissAll(notifd.get_notifications())}
            />
            <Gtk.ToggleButton
                onClicked={(self) => bus.emit('system:dnd:set', self.active)}
                active={bind(dnd, 'dnd')}
                cursor={Gdk.Cursor.new_from_name('pointer', null)}
                iconName={'notifications-disabled-symbolic'}
                tooltipText={'Do Not Disturb'}
                cssClasses={bind(dnd, 'dnd').as((d) =>
                    d ? ['suggested-action', 'warning'] : ['flat']
                )}
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
                cssClasses={['caption', 'dim-label']}
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
        const styles = useStyle({marginBottom: '4px'});
        return (
            <Adw.ActionRow
                title={entry.summary}
                subtitle={`${entry.appName} — ${entry.body || ''}`}
                subtitleLines={1}
                cssClasses={[styles.class]}
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
                />
            </Adw.ActionRow>
        );
    };

    const NotificationGroup = ({notifications}: {notifications: Notifd.Notification[]}) => {
        const [visible, setVisible] = createState(false);

        const Heading = () => (
            <Gtk.Box cssClasses={['toolbar']}>
                <Gtk.ToggleButton
                    onClicked={() => setVisible(!visible())}
                    active={visible}
                    cssClasses={['flat']}
                >
                    <Gtk.Box>
                        <Gtk.Image iconName={notifications[0]?.appIcon} />
                        <Gtk.Label
                            label={notifications[0]?.appName}
                            hexpand
                            cssClasses={['caption-heading']}
                        />
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
                    onClicked={() => dismissAll(notifications)}
                />
            </Gtk.Box>
        );

        return (
            <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                <Heading />
                <Notification
                    notification={notifications[0]!}
                    variant="list"
                    showProgress={showProgress}
                    closeAction={(n) => n.dismiss()}
                />
                <Gtk.Revealer revealChild={visible}>
                    <Gtk.Box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
                        {/* Static slice — the parent For recreates this group
                            whenever membership changes, so plain map is safe. */}
                        {notifications.slice(1).map((notif) => (
                            <Notification
                                notification={notif}
                                variant="list"
                                showProgress={showProgress}
                                closeAction={(n) => n.dismiss()}
                            />
                        ))}
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
            <For each={bind(notifd, 'notifications').as(groupByApp)}>
                {(group: Notifd.Notification[]) =>
                    group.length === 1 ? (
                        <Notification
                            closeAction={(n) => n.dismiss()}
                            showProgress={showProgress}
                            notification={group[0]!}
                            variant="list"
                        />
                    ) : (
                        <NotificationGroup notifications={group} />
                    )
                }
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
