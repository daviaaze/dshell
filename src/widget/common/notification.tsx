import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {For, bind} from 'gnim';
import {useStyle} from '#/style/useStyle';
import {tickWhileAttached} from '#/lib/core/widgetTimer';
import Adw from 'gi://Adw?version=1';

function relativeTime(unix: number): string {
    const now = GLib.DateTime.new_now_local();
    const then = GLib.DateTime.new_from_unix_local(unix);
    const diff = now.difference(then);
    const seconds = Number(diff.valueOf()) / 1_000_000;

    if (seconds < 10) return 'now';
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function fullTimestamp(unix: number): string {
    return (
        GLib.DateTime.new_from_unix_local(unix).format('%H:%M:%S') || 'ERROR'
    );
}

export default ({
    notification,
    closeAction,
    pauseDismiss,
    resumeDismiss,
    showProgress = true,
}: {
    notification: Notifd.Notification;
    closeAction: (notif: Notifd.Notification, self: Gtk.Widget) => void;
    pauseDismiss?: () => void;
    resumeDismiss?: () => void;
    showProgress?: boolean;
}) => {
    const dimmedStyle = useStyle({
        opacity: '0.6',
    });
    const notifImageStyle = useStyle({
        'border-radius': '8px',
    });
    const notifProgressStyle = useStyle({
        'min-height': '4px',
        'border-radius': '2px',
    });
    const notifActionsStyle = useStyle({});

    const expireMs =
        notification.expire_timeout > 0 ? notification.expire_timeout : 5000;
    const urgency = notification.urgency;
    const appName = notification.app_name || notification.appName || '';
    const hasImage = !!notification.image;
    const bodyText = notification.body || '';
    const hasActions = notification.actions.length > 0;
    const isCritical = urgency === Notifd.Urgency.CRITICAL;
    const isLow = urgency === Notifd.Urgency.LOW;
    const useMarkup = /<[a-zA-Z/]/.test(bodyText);

    return (
        <Adw.Clamp widthRequest={360}>
            <Gtk.Box
                name={notification.id.toString()}
                cssClasses={[
                    'card',
                    'frame',
                    'p-12',
                    'notification-card',
                    // Use Libadwaita's built-in style classes for urgency
                    isCritical ? 'notification-critical' : '',
                    isLow ? 'dimmed' : '',
                ].filter(Boolean)}
                spacing={8}
                orientation={Gtk.Orientation.VERTICAL}
                tooltipText={`${appName} · ${fullTimestamp(notification.time)}`}
                ref={self => {
                    if (pauseDismiss && resumeDismiss) {
                        const controller = Gtk.EventControllerMotion.new();
                        controller.connect('enter', pauseDismiss);
                        controller.connect('leave', resumeDismiss);
                        self.add_controller(controller);
                    }
                }}
            >
                {/* Header: app icon + summary + timestamp + close */}
                <Gtk.Box spacing={8}>
                    <Gtk.Image
                        pixelSize={24}
                        visible={!!notification.app_icon}
                        iconName={notification.app_icon}
                    />
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        hexpand
                        spacing={2}
                    >
                        <Gtk.Box spacing={6}>
                            <Gtk.Label
                                wrap
                                hexpand
                                cssClasses={['title-4']}
                                label={notification.summary || ''}
                                xalign={0}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                label={relativeTime(notification.time)}
                                valign={Gtk.Align.CENTER}
                            />
                        </Gtk.Box>
                        {appName ? (
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed', dimmedStyle.class]}
                                ref={dimmedStyle.$}
                                label={appName}
                                xalign={0}
                            />
                        ) : null}
                    </Gtk.Box>
                    <Gtk.Button
                        halign={Gtk.Align.END}
                        valign={Gtk.Align.START}
                        // Libadwaita: circular + flat is the standard toast close button style
                        cssClasses={[
                            'circular',
                            'flat',
                            isCritical ? 'destructive-action' : '',
                        ].filter(Boolean)}
                        onClicked={self =>
                            closeAction(notification, self.parent!.parent!)
                        }
                        iconName={'window-close-symbolic'}
                    />
                </Gtk.Box>

                {/* Body + optional image */}
                <Gtk.Box spacing={8}>
                    {hasImage ? (
                        <Gtk.Image
                            cssClasses={['notification-image', notifImageStyle.class]}
                            ref={notifImageStyle.$}
                            file={notification.image}
                            pixelSize={64}
                            valign={Gtk.Align.START}
                        />
                    ) : null}
                    <Gtk.Label
                        wrap
                        hexpand
                        maxWidthChars={hasImage ? 20 : 30}
                        // Libadwaita .body class: increased line height for legible text
                        cssClasses={['body']}
                        useMarkup={useMarkup}
                        label={bodyText}
                        xalign={0}
                    />
                </Gtk.Box>

                {/* Progress bar */}
                <Gtk.ProgressBar
                    visible={showProgress}
                    fraction={1}
                    cssClasses={['notification-progress', notifProgressStyle.class]}
                    ref={self => {
                        notifProgressStyle.$(self);
                        if (!showProgress) return;
                        let elapsed = 0;
                        const interval = 50;
                        tickWhileAttached(self, interval, () => {
                            elapsed += interval;
                            const remaining = Math.max(
                                0,
                                (expireMs - elapsed) / expireMs
                            );
                            self.set_fraction(remaining);
                            return remaining > 0;
                        });
                    }}
                />

                {/* Action buttons */}
                {hasActions ? (
                    <Gtk.Box cssClasses={['notification-actions', notifActionsStyle.class]} spacing={4}>
                        <For
                            each={bind(notification, 'actions').as(
                                actions =>
                                    actions.filter(
                                        a => a.label && a.label.trim() !== ''
                                    )
                            )}
                        >
                            {(action: Notifd.Action) => (
                                <Gtk.Button
                                    // Libadwaita: flat + suggested-action for toast action buttons
                                    cssClasses={['flat', 'suggested-action']}
                                    onClicked={() =>
                                        notification.invoke(action.id)
                                    }
                                    label={action.label}
                                />
                            )}
                        </For>
                    </Gtk.Box>
                ) : null}
            </Gtk.Box>
        </Adw.Clamp>
    ) as unknown as Gtk.Widget;
};
