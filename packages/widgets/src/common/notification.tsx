import Adw from 'gi://Adw?version=1';
import Notifd from 'gi://AstalNotifd';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {relativeTime} from '@shade/core/time';
import {tickWhileAttached} from '@shade/core/widgetTimer';
import {getExpireMs} from '@shade/services/notifications/expire';
import {getNotifdSafe} from '@shade/services/notifications/guard';
import {type Accessor, bind, computed, For} from 'gnim';
import {COMPACT_SURFACE_PADDING} from './surface';

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

/** Pango rejects unbalanced or unknown tags; those bodies must render as plain text. */
function isValidMarkup(text: string): boolean {
    try {
        Pango.parse_markup(text, -1, '\0');
        return true;
    } catch {
        return false;
    }
}

function addDefaultAction(self: Gtk.Widget, onDefaultAction?: () => void) {
    if (!onDefaultAction) return;
    self.set_cursor_from_name('pointer');
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
    isLow,
    onDefaultAction,
    closeLabel,
}: {
    snapshot: NotificationSnapshot;
    isCritical: boolean;
    isLow: boolean;
    onClose: () => void;
    onDefaultAction?: () => void;
    closeLabel: string;
}) {
    return (
        <Gtk.Box spacing={8} orientation={Gtk.Orientation.HORIZONTAL}>
            <Gtk.Image pixelSize={24} visible={!!snapshot.appIcon} iconName={snapshot.appIcon} />
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                hexpand
                spacing={2}
                ref={(self) => addDefaultAction(self, onDefaultAction)}
            >
                <Gtk.Box spacing={6} orientation={Gtk.Orientation.HORIZONTAL}>
                    <Gtk.Label
                        wrap
                        hexpand
                        cssClasses={[
                            'title-4',
                            ...(isCritical ? ['error'] : []),
                            ...(isLow ? ['dimmed'] : []),
                        ]}
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
                    <Gtk.Label
                        cssClasses={['caption', 'dimmed']}
                        label={snapshot.appName}
                        xalign={0}
                    />
                ) : null}
            </Gtk.Box>
            <Gtk.Button
                halign={Gtk.Align.END}
                valign={Gtk.Align.START}
                // Libadwaita: circular + flat is the standard toast close
                // button style.
                cssClasses={['circular', 'flat']}
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
    dimmed,
    onDefaultAction,
    compact,
}: {
    snapshot: NotificationSnapshot;
    imagePixelSize: number;
    maxChars: number;
    useMarkup: boolean;
    dimmed: boolean;
    onDefaultAction?: () => void;
    compact: boolean;
}) {
    return (
        <Gtk.Box
            spacing={8}
            orientation={Gtk.Orientation.HORIZONTAL}
            ref={(self) => addDefaultAction(self, onDefaultAction)}
        >
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
                lines={compact ? 3 : -1}
                ellipsize={compact ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE}
                // Libadwait .body class: increased line height for legible text.
                cssClasses={dimmed ? ['body', 'dimmed'] : ['body']}
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
        <Gtk.Box spacing={4} orientation={Gtk.Orientation.HORIZONTAL}>
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
    compact = false,
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
    compact?: boolean;
    onDefaultAction?: () => void;
    onActionInvoked?: () => void;
}) => {
    const snapshot = notificationSnapshot(notification);

    // Captured via ref so closeAction receives the card widget directly.
    let card: Gtk.Box;

    const imagePixelSize = variant === 'popup' ? 48 : 64;
    const clampWidth = variant === 'popup' ? 360 : 320;
    const closeLabel =
        variant === 'popup' ? 'Fechar aviso de notificação' : 'Dispensar notificação';
    const handleClose = () => closeAction(notification, card);

    return (
        <Adw.Clamp
            widthRequest={clampWidth}
            maximumSize={variant === 'list' ? 10000 : 600}
            tighteningThreshold={variant === 'list' ? 10000 : 400}
        >
            <For each={snapshot}>
                {(current: NotificationSnapshot) => {
                    const isCritical = current.urgency === Notifd.Urgency.CRITICAL;
                    const isLow = current.urgency === Notifd.Urgency.LOW;
                    const hasImage = !!current.image;
                    const hasActions = showActions && current.actions.length > 0;
                    const useMarkup =
                        /<[a-zA-Z/]/.test(current.body) && isValidMarkup(current.body);
                    const maxChars = hasImage ? 20 : 30;
                    const expireMs = getExpireMs(
                        {expireTimeout: current.expireTimeout},
                        getNotifdSafe()
                    );

                    return (
                        <Gtk.Box
                            name={notification.id.toString()}
                            cssClasses={['card']}
                            css={variant === 'popup' ? 'background-color: @window_bg_color;' : ''}
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
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={8}
                                marginTop={variant === 'popup' ? COMPACT_SURFACE_PADDING : 0}
                                marginBottom={variant === 'popup' ? COMPACT_SURFACE_PADDING : 0}
                                marginStart={variant === 'popup' ? COMPACT_SURFACE_PADDING : 0}
                                marginEnd={variant === 'popup' ? COMPACT_SURFACE_PADDING : 0}
                            >
                                <CardHeader
                                    snapshot={current}
                                    isCritical={isCritical}
                                    isLow={isLow}
                                    onClose={handleClose}
                                    onDefaultAction={onDefaultAction}
                                    closeLabel={closeLabel}
                                />
                                <CardBody
                                    snapshot={current}
                                    imagePixelSize={imagePixelSize}
                                    maxChars={maxChars}
                                    useMarkup={useMarkup}
                                    dimmed={isLow}
                                    compact={compact}
                                    onDefaultAction={onDefaultAction}
                                />
                                {showProgress && !isCritical ? (
                                    <CardProgress expireMs={expireMs} />
                                ) : null}
                                {hasActions ? (
                                    <CardActions
                                        notification={notification}
                                        actions={current.actions}
                                        onActionInvoked={onActionInvoked}
                                    />
                                ) : null}
                            </Gtk.Box>
                        </Gtk.Box>
                    );
                }}
            </For>
        </Adw.Clamp>
    );
};
