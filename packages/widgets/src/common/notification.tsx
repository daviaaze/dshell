import Adw from 'gi://Adw?version=1';
import Notifd from 'gi://AstalNotifd';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {relativeTime} from '@shade/core/time';
import {tickWhileAttached} from '@shade/core/widgetTimer';
import {getExpireMs} from '@shade/services/notifications/expire';
import {getNotifdSafe} from '@shade/services/notifications/guard';
import {bind, computed, For, type Accessor} from 'gnim';
interface NotificationSnapshot {
    summary: string;
    body: string;
    appName: string;
    appIcon: string;
    time: number;
    image: string;
    urgency: Notifd.Urgency;
    actions: Notifd.Action[];
    expireTimeout: number;
}

function notificationSnapshot(notification: Notifd.Notification): Accessor<NotificationSnapshot[]> {
    const summary = bind(notification, 'summary');
    const body = bind(notification, 'body');
    const appName = bind(notification, 'app-name');
    const appIcon = bind(notification, 'app-icon');
    const time = bind(notification, 'time');
    const image = bind(notification, 'image');
    const urgency = bind(notification, 'urgency');
    const actions = bind(notification, 'actions');
    const expireTimeout = bind(notification, 'expire-timeout');

    return computed(() => [
        {
            summary: summary(),
            body: body(),
            appName: appName(),
            appIcon: appIcon(),
            time: time(),
            image: image(),
            urgency: urgency(),
            actions: actions(),
            expireTimeout: expireTimeout(),
        },
    ]);
}

function addDefaultAction(self: Gtk.Widget, onDefaultAction?: () => void) {
    if (!onDefaultAction) return;
    const click = Gtk.GestureClick.new();
    click.connect('pressed', onDefaultAction);
    self.add_controller(click);
}

/**
 * Shared notification card header — app icon, summary, timestamp and close.
 */
function CardHeader({
    snapshot,
    isCritical,
    onClose,
    onDefaultAction,
    closeLabel,
}: {
    snapshot: NotificationSnapshot;
    isCritical: boolean;
    onClose: () => void;
    onDefaultAction?: () => void;
    closeLabel: string;
}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Image
                pixelSize={24}
                visible={!!snapshot.appIcon}
                iconName={snapshot.appIcon}
            />
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                hexpand
                spacing={2}
                ref={(self) => addDefaultAction(self, onDefaultAction)}
            >
                <Gtk.Box spacing={6}>
                    <Gtk.Label
                        wrap
                        hexpand
                        cssClasses={['title-4']}
                        label={snapshot.summary || ''}
                        xalign={0}
                    />
                    <Gtk.Label
                        cssClasses={['caption', 'numeric']}
                        label={relativeTime(snapshot.time)}
                        valign={Gtk.Align.CENTER}
                    />
                </Gtk.Box>
                {snapshot.appName ? (
                    <Gtk.Label cssClasses={['caption', 'dimmed']} label={snapshot.appName} xalign={0} />
                ) : null}
            </Gtk.Box>
            <Gtk.Button
                halign={Gtk.Align.END}
                valign={Gtk.Align.START}
                // Libadwaita: circular + flat is the standard toast close
                // button style.
                cssClasses={['circular', 'flat', isCritical ? 'destructive-action' : ''].filter(
                    Boolean
                )}
                onClicked={onClose}
                iconName={'window-close-symbolic'}
                tooltipText={closeLabel}
                ref={(self) =>
                    self.update_property(
                        [Gtk.AccessibleProperty.LABEL],
                        [new GObject.Value(GObject.TYPE_STRING, closeLabel)]
                    )
                }
            />
        </Gtk.Box>
    );
}

/**
 * Card body — optional image next to the body text.
 */
function CardBody({
    snapshot,
    imagePixelSize,
    maxChars,
    useMarkup,
    onDefaultAction,
}: {
    snapshot: NotificationSnapshot;
    imagePixelSize: number;
    maxChars: number;
    useMarkup: boolean;
    onDefaultAction?: () => void;
}) {
    return (
        <Gtk.Box spacing={8} ref={(self) => addDefaultAction(self, onDefaultAction)}>
            {snapshot.image ? (
                <Gtk.Image
                    file={snapshot.image}
                    pixelSize={imagePixelSize}
                    valign={Gtk.Align.START}
                />
            ) : null}
            <Gtk.Label
                wrap
                hexpand
                maxWidthChars={maxChars}
                // Libadwait .body class: increased line height for legible text.
                cssClasses={['body']}
                useMarkup={useMarkup}
                label={snapshot.body}
                xalign={0}
            />
        </Gtk.Box>
    );
}

/**
 * Optional countdown progress bar for timed notifications.
 */
function CardProgress({expireMs}: {expireMs: number}) {
    return (
        <Gtk.ProgressBar
            fraction={1}
            ref={(self) => {
                let elapsed = 0;
                const interval = 50;
                tickWhileAttached(self, interval, () => {
                    elapsed += interval;
                    const remaining = Math.max(0, (expireMs - elapsed) / expireMs);
                    self.set_fraction(remaining);
                    return remaining > 0;
                });
            }}
        />
    );
}

/**
 * Optional notification action buttons, filtered to non-empty labels.
 */
function CardActions({
    notification,
    actions,
    onActionInvoked,
}: {
    notification: Notifd.Notification;
    actions: Notifd.Action[];
    onActionInvoked?: () => void;
}) {
    return (
        <Gtk.Box spacing={4}>
            <For each={computed(() => actions.filter((a) => a.label && a.label.trim() !== ''))}>
                {(action: Notifd.Action) => (
                    <Gtk.Button
                        cssClasses={['flat']}
                        onClicked={() => {
                            notification.invoke(action.id);
                            onActionInvoked?.();
                        }}
                        label={action.label}
                    />
                )}
            </For>
        </Gtk.Box>
    );
}

/**
 * Shared notification card — used by popup, quicksettings list, and
 * lockscreen. Visual differences are driven by props, not by forking
 * the component.
 *
 * @param variant  Visual context; controls image size and clamp width.
 * @param showActions  Lockscreen hides action buttons for security.
 * @param showProgress  Countdown bar; off by default (see generalSchema).
 * @param onDefaultAction  Clicking noninteractive card content invokes the
 *   notification's default action (GNOME toast parity). Omit to disable.
 */
export default ({
    notification,
    closeAction,
    pauseDismiss,
    resumeDismiss,
    showProgress = false,
    showActions = true,
    variant = 'popup',
    onDefaultAction,
    onActionInvoked,
}: {
    notification: Notifd.Notification;
    closeAction: (notif: Notifd.Notification, self: Gtk.Widget) => void;
    pauseDismiss?: () => void;
    resumeDismiss?: () => void;
    showProgress?: boolean;
    showActions?: boolean;
    variant?: 'popup' | 'list' | 'lockscreen';
    onDefaultAction?: () => void;
    onActionInvoked?: () => void;
}) => {
    const snapshot = notificationSnapshot(notification);

    // Captured via ref so closeAction receives the card widget directly.
    let card: Gtk.Box;

    const imagePixelSize = variant === 'popup' ? 48 : 64;
    const clampWidth = variant === 'popup' ? 360 : 320;
    const closeLabel = variant === 'popup' ? 'Close notification toast' : 'Dismiss notification';
    const handleClose = () => closeAction(notification, card);

    return (
        <Adw.Clamp widthRequest={clampWidth}>
            <For each={snapshot}>
                {(current: NotificationSnapshot) => {
                    const isCritical = current.urgency === Notifd.Urgency.CRITICAL;
                    const isLow = current.urgency === Notifd.Urgency.LOW;
                    const hasImage = !!current.image;
                    const hasActions = showActions && current.actions.length > 0;
                    const useMarkup = /<[a-zA-Z/]/.test(current.body);
                    const maxChars = hasImage ? 20 : 30;
                    const expireMs = getExpireMs(
                        {expireTimeout: current.expireTimeout},
                        getNotifdSafe()
                    );
                    const urgencyClass = isCritical ? 'error' : isLow ? 'dimmed' : '';

                    return (
                        <Gtk.Box
                            name={notification.id.toString()}
                            cssClasses={['card', urgencyClass].filter(Boolean)}
                            css={'padding: 12px; margin: 12px; box-shadow: none; background-color: @window_bg_color;'}
                            spacing={8}
                            orientation={Gtk.Orientation.VERTICAL}
                            ref={(self) => {
                                card = self;
                                if (pauseDismiss && resumeDismiss) {
                                    const controller = Gtk.EventControllerMotion.new();
                                    controller.connect('enter', pauseDismiss);
                                    controller.connect('leave', resumeDismiss);
                                    self.add_controller(controller);
                                }
                            }}
                        >
                            <CardHeader
                                snapshot={current}
                                isCritical={isCritical}
                                onClose={handleClose}
                                onDefaultAction={onDefaultAction}
                                closeLabel={closeLabel}
                            />
                            <CardBody
                                snapshot={current}
                                imagePixelSize={imagePixelSize}
                                maxChars={maxChars}
                                useMarkup={useMarkup}
                                onDefaultAction={onDefaultAction}
                            />
                            {showProgress && !isCritical ? <CardProgress expireMs={expireMs} /> : null}
                            {hasActions ? (
                                <CardActions
                                    notification={notification}
                                    actions={current.actions}
                                    onActionInvoked={onActionInvoked}
                                />
                            ) : null}
                        </Gtk.Box>
                    );
                }}
            </For>
        </Adw.Clamp>
    );
};
