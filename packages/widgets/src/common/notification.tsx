import Adw from 'gi://Adw?version=1';
import Notifd from 'gi://AstalNotifd';
import Gtk from 'gi://Gtk?version=4.0';
import {relativeTime} from '@shade/core/time';
import {tickWhileAttached} from '@shade/core/widgetTimer';
import {getExpireMs} from '@shade/services/notifications/expire';
import {getNotifdSafe} from '@shade/services/notifications/guard';
import {bind, For} from 'gnim';

/**
 * Shared notification card header — app icon, summary, timestamp and close.
 */
function CardHeader({
    notification,
    appName,
    isCritical,
    onClose,
}: {
    notification: Notifd.Notification;
    appName: string;
    isCritical: boolean;
    onClose: () => void;
}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Image
                pixelSize={24}
                visible={!!notification.appIcon}
                iconName={notification.appIcon}
            />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand spacing={2}>
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
                    <Gtk.Label cssClasses={['caption', 'dim-label']} label={appName} xalign={0} />
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
            />
        </Gtk.Box>
    );
}

/**
 * Card body — optional image next to the body text.
 */
function CardBody({
    notification,
    imagePixelSize,
    maxChars,
    useMarkup,
    bodyText,
}: {
    notification: Notifd.Notification;
    imagePixelSize: number;
    maxChars: number;
    useMarkup: boolean;
    bodyText: string;
}) {
    return (
        <Gtk.Box spacing={8}>
            {notification.image ? (
                <Gtk.Image
                    file={notification.image}
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
                label={bodyText}
                xalign={0}
            />
        </Gtk.Box>
    );
}

/**
 * Optional countdown progress bar for timed notifications.
 */
function CardProgress({showProgress, expireMs}: {showProgress: boolean; expireMs: number}) {
    return (
        <Gtk.ProgressBar
            visible={showProgress}
            fraction={1}
            ref={(self) => {
                if (!showProgress) return;
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
function CardActions({notification}: {notification: Notifd.Notification}) {
    return (
        <Gtk.Box spacing={4}>
            <For
                each={bind(notification, 'actions').as((actions) =>
                    actions.filter((a) => a.label && a.label.trim() !== '')
                )}
            >
                {(action: Notifd.Action) => (
                    <Gtk.Button
                        cssClasses={['flat']}
                        onClicked={() => notification.invoke(action.id)}
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
 * @param onDefaultAction  Clicking the card body invokes the
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
}: {
    notification: Notifd.Notification;
    closeAction: (notif: Notifd.Notification, self: Gtk.Widget) => void;
    pauseDismiss?: () => void;
    resumeDismiss?: () => void;
    showProgress?: boolean;
    showActions?: boolean;
    variant?: 'popup' | 'list' | 'lockscreen';
    onDefaultAction?: () => void;
}) => {
    const urgency = notification.urgency;
    const isCritical = urgency === Notifd.Urgency.CRITICAL;
    const isLow = urgency === Notifd.Urgency.LOW;

    const expireMs = getExpireMs(notification, getNotifdSafe());
    const appName = notification.appName || '';
    const hasImage = !!notification.image;
    const bodyText = notification.body || '';
    const hasActions = showActions && notification.actions.length > 0;
    const useMarkup = /<[a-zA-Z/]/.test(bodyText);

    // Captured via ref so closeAction receives the card widget directly.
    let card: Gtk.Box;

    const imagePixelSize = variant === 'popup' ? 48 : 64;
    const clampWidth = variant === 'popup' ? 360 : 320;
    const maxChars = hasImage ? 20 : 30;

    // Urgency drives a single extra class; native GTK classes (.error, .dimmed) handle styling.
    let urgencyClass = '';
    if (isCritical) {
        urgencyClass = 'error';
    } else if (isLow) {
        urgencyClass = 'dimmed';
    }

    const handleClose = () => closeAction(notification, card);

    return (
        <Adw.Clamp widthRequest={clampWidth}>
            <Gtk.Box
                name={notification.id.toString()}
                marginTop={12}
                marginBottom={12}
                marginStart={12}
                marginEnd={12}
                cssClasses={['card', urgencyClass].filter(Boolean)}
                spacing={8}
                orientation={Gtk.Orientation.VERTICAL}
                ref={(self) => {
                    card = self;
                    // Clicking the card body invokes the default action.
                    if (onDefaultAction) {
                        const click = Gtk.GestureClick.new();
                        click.connect('pressed', onDefaultAction);
                        self.add_controller(click);
                    }
                    if (pauseDismiss && resumeDismiss) {
                        const controller = Gtk.EventControllerMotion.new();
                        controller.connect('enter', pauseDismiss);
                        controller.connect('leave', resumeDismiss);
                        self.add_controller(controller);
                    }
                }}
            >
                <CardHeader
                    notification={notification}
                    appName={appName}
                    isCritical={isCritical}
                    onClose={handleClose}
                />
                <CardBody
                    notification={notification}
                    imagePixelSize={imagePixelSize}
                    maxChars={maxChars}
                    useMarkup={useMarkup}
                    bodyText={bodyText}
                />
                <CardProgress showProgress={showProgress} expireMs={expireMs} />
                {hasActions ? <CardActions notification={notification} /> : null}
            </Gtk.Box>
        </Adw.Clamp>
    );
};
