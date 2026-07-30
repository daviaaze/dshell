import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {For, bind} from 'gnim';
import {tickWhileAttached} from '../../lib/core/widgetTimer';
import {relativeTime, fullTimestamp} from '../../lib/core/time';
import {getExpireMs} from '../../lib/services/notifications/expire';
import {getNotifdSafe} from '../../lib/services/notifications/guard';

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
    const urgency = notification.urgency;
    const isCritical = urgency === Notifd.Urgency.CRITICAL;
    const isLow = urgency === Notifd.Urgency.LOW;

    const expireMs = getExpireMs(notification, getNotifdSafe());
    const appName = notification.appName || '';
    const hasImage = !!notification.image;
    const bodyText = notification.body || '';
    const hasActions = notification.actions.length > 0;
    const useMarkup = /<[a-zA-Z/]/.test(bodyText);

    // Captured via ref so closeAction receives the card widget directly
    // (no fragile parent traversal from the close button).
    let card: Gtk.Box;

    return (
        <Adw.Clamp widthRequest={360}>
            <Gtk.Box
                name={notification.id.toString()}
                cssClasses={['card', 'frame', 'p-12']}
                spacing={8}
                orientation={Gtk.Orientation.VERTICAL}
                tooltipText={`${appName} · ${fullTimestamp(notification.time)}`}
                ref={self => {
                    card = self;
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
                        visible={!!notification.appIcon}
                        iconName={notification.appIcon}
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
                                cssClasses={['caption', 'dim-label']}
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
                        onClicked={() => closeAction(notification, card)}
                        iconName={'window-close-symbolic'}
                    />
                </Gtk.Box>

                {/* Body + optional image */}
                <Gtk.Box spacing={8}>
                    {hasImage ? (
                        <Gtk.Image
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
                    ref={self => {
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
                    <Gtk.Box spacing={4}>
                        <For
                            each={bind(notification, 'actions').as(actions =>
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
    );
};
