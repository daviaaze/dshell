import Adw from 'gi://Adw?version=1';
import type Notifd from 'gi://AstalNotifd';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {IconNames} from '@shade/core/iconNames';
import {relativeTime} from '@shade/core/time';
import {tickWhileAttached} from '@shade/core/widgetTimer';
import {
    type Accessor,
    computed,
    createState,
    effect,
    For,
    type MaybeAccessor,
    onCleanup,
    prop,
} from 'gnim';
import {
    actionButtons,
    hasDefaultAction,
    notificationTextBounds,
    notificationUrgency,
    type NotificationActionButton,
    type NotificationVariant,
} from './notificationModel';
import {COMPACT_SURFACE_PADDING} from './surface';

interface NotificationSnapshot {
    summary: string;
    body: string;
    appName: string;
    appIcon: string;
    time: number;
    image: string;
    urgency: number;
    actions: Notifd.Action[];
}

/** Update properties in place, including when the daemon replaces an object with the same id. */
function notificationSnapshot(source: Accessor<Notifd.Notification>): Accessor<NotificationSnapshot> {
    const read = (notification: Notifd.Notification): NotificationSnapshot => ({
        summary: notification.summary,
        body: notification.body,
        appName: notification.appName,
        appIcon: notification.appIcon,
        time: notification.time,
        image: notification.image,
        urgency: notification.urgency,
        actions: notification.actions,
    });
    const [snapshot, setSnapshot] = createState(read(source()));
    effect(() => {
        const notification = source();
        const refresh = () => setSnapshot(read(notification));
        const signal = notification.connect('notify', refresh);
        refresh();
        onCleanup(() => notification.disconnect(signal));
    });
    return snapshot;
}

/** Pango rejects unbalanced or unknown tags; render those bodies as literal text. */
function isValidMarkup(text: string): boolean {
    try {
        Pango.parse_markup(text, -1, '\0');
        return true;
    } catch {
        return false;
    }
}

function CardHeader({
    snapshot,
    closeLabel,
    closeOpacity,
    onClose,
}: {
    snapshot: Accessor<NotificationSnapshot>;
    closeLabel: string;
    closeOpacity: Accessor<number>;
    onClose: () => void;
}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Image
                pixelSize={16}
                iconName={snapshot.as((n) => n.appIcon || IconNames.dialogInformation)}
            />
            <Gtk.Label
                cssClasses={['caption', 'dimmed']}
                label={snapshot.as((n) => n.appName || 'Notificação')}
                tooltipText={snapshot.as((n) => n.appName)}
                ellipsize={Pango.EllipsizeMode.END}
                widthChars={1}
                maxWidthChars={24}
                hexpand
                xalign={0}
            />
            <Gtk.Label
                cssClasses={['caption', 'dimmed', 'numeric']}
                label={snapshot.as((n) => relativeTime(n.time))}
                ref={(self) =>
                    tickWhileAttached(self, 1000, () => {
                        self.label = relativeTime(snapshot().time);
                    })
                }
            />
            <Gtk.Button
                cssClasses={['flat', 'circular']}
                iconName={IconNames.windowClose}
                tooltipText={closeLabel}
                opacity={closeOpacity}
                onClicked={onClose}
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

function CardMessage({
    snapshot,
    variant,
}: {
    snapshot: Accessor<NotificationSnapshot>;
    variant: NotificationVariant;
}) {
    const bounds = notificationTextBounds(variant);
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8} hexpand>
            <Gtk.Box spacing={8}>
                <Gtk.Image
                    visible={snapshot.as((n) => notificationUrgency(n.urgency).critical)}
                    iconName={IconNames.dialogWarning}
                    pixelSize={16}
                    valign={Gtk.Align.START}
                    cssClasses={['error']}
                    tooltipText="Notificação crítica"
                    ref={(self) =>
                        self.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Notificação crítica')]
                        )
                    }
                />
                <Gtk.Label
                    cssClasses={['heading']}
                    label={snapshot.as((n) => n.summary || 'Notificação')}
                    tooltipText={snapshot.as((n) => n.summary)}
                    wrap
                    wrapMode={Pango.WrapMode.WORD_CHAR}
                    lines={bounds.summaryLines}
                    ellipsize={Pango.EllipsizeMode.END}
                    widthChars={1}
                    maxWidthChars={40}
                    hexpand
                    xalign={0}
                />
            </Gtk.Box>
            <Gtk.Box visible={snapshot.as((n) => !!n.body || !!n.image)} spacing={8}>
                <Gtk.Image
                    visible={snapshot.as((n) => !!n.image)}
                    ref={(self) =>
                        effect(() => {
                            const image = snapshot().image;
                            if (image) self.set_from_file(image);
                            else self.clear();
                        })
                    }
                    pixelSize={variant === 'popup' ? 48 : 64}
                    valign={Gtk.Align.START}
                />
                <Gtk.Label
                    visible={snapshot.as((n) => !!n.body)}
                    cssClasses={['body']}
                    wrap
                    wrapMode={Pango.WrapMode.WORD_CHAR}
                    lines={bounds.bodyLines}
                    ellipsize={bounds.bodyLines > 0 ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE}
                    widthChars={1}
                    maxWidthChars={40}
                    hexpand
                    xalign={0}
                    ref={(self) =>
                        effect(() => {
                            const text = snapshot().body;
                            if (/<[a-zA-Z/]/.test(text) && isValidMarkup(text)) self.set_markup(text);
                            else self.set_text(text);
                        })
                    }
                />
            </Gtk.Box>
        </Gtk.Box>
    );
}

function CardActions({
    notification,
    actions,
    onActionInvoked,
}: {
    notification: Accessor<Notifd.Notification>;
    actions: Accessor<NotificationActionButton[]>;
    onActionInvoked?: () => void;
}) {
    return (
        <Gtk.Box
            visible={actions.as((items) => items.length > 0)}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            marginTop={4}
        >
            <Gtk.Separator />
            <Gtk.FlowBox
                selectionMode={Gtk.SelectionMode.NONE}
                minChildrenPerLine={1}
                maxChildrenPerLine={10}
                columnSpacing={8}
                rowSpacing={8}
                homogeneous
            >
                <For each={actions}>
                    {(action) => (
                        <Gtk.Button
                            cssClasses={action.suggested ? ['suggested-action'] : ['flat']}
                            tooltipText={action.label}
                            onClicked={() => {
                                notification().invoke(action.id);
                                onActionInvoked?.();
                            }}
                        >
                            <Gtk.Label
                                label={action.label}
                                wrap
                                wrapMode={Pango.WrapMode.WORD_CHAR}
                                widthChars={1}
                                maxWidthChars={18}
                            />
                        </Gtk.Button>
                    )}
                </For>
            </Gtk.FlowBox>
        </Gtk.Box>
    );
}

/**
 * One stable card for toasts, the center and allowed lock-screen content.
 * Toast countdown/progress share their owner's clock; the center never expires cards.
 */
export default ({
    notification,
    closeAction,
    pauseDismiss,
    resumeDismiss,
    showProgress = false,
    progress,
    showActions = true,
    variant = 'popup',
    maxHeight,
    onDefaultAction,
    onActionInvoked,
}: {
    notification: MaybeAccessor<Notifd.Notification>;
    closeAction: (notif: Notifd.Notification, self: Gtk.Widget) => void;
    pauseDismiss?: () => void;
    resumeDismiss?: () => void;
    showProgress?: boolean;
    progress?: () => number;
    showActions?: boolean;
    variant?: NotificationVariant;
    maxHeight?: Accessor<number>;
    onDefaultAction?: () => void;
    onActionInvoked?: () => void;
}) => {
    const current = prop(notification);
    const snapshot = notificationSnapshot(current);
    const critical = snapshot.as((n) => notificationUrgency(n.urgency).critical);
    const actions = snapshot.as((n) => actionButtons(n.actions));
    const defaultEnabled = snapshot.as(
        (n) => showActions && !!onDefaultAction && hasDefaultAction(n.actions)
    );
    const [hovered, setHovered] = createState(false);
    const [focused, setFocused] = createState(false);
    const closeOpacity = computed(() => variant !== 'popup' || hovered() || focused() ? 1 : 0);
    const closeLabel = variant === 'popup' ? 'Fechar aviso de notificação' : 'Dispensar notificação';
    let card: Gtk.Box;

    const content = (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8} hexpand>
            <CardHeader
                snapshot={snapshot}
                closeLabel={closeLabel}
                closeOpacity={closeOpacity}
                onClose={() => closeAction(current(), card)}
            />
            <For each={defaultEnabled.as((enabled) => [enabled])}>
                {(enabled: boolean) => enabled ? (
                    <Gtk.Button
                        cssClasses={['flat']}
                        css="padding: 0;"
                        tooltipText="Abrir notificação"
                        onClicked={() => onDefaultAction?.()}
                        ref={(self) => self.set_cursor_from_name('pointer')}
                    >
                        <CardMessage snapshot={snapshot} variant={variant} />
                    </Gtk.Button>
                ) : (
                    <CardMessage snapshot={snapshot} variant={variant} />
                )}
            </For>
            {showProgress && progress ? (
                <Gtk.ProgressBar
                    visible={critical.as((value) => !value)}
                    fraction={progress()}
                    ref={(self) =>
                        tickWhileAttached(self, 50, () => {
                            self.fraction = progress();
                        })
                    }
                />
            ) : null}
            {showActions ? (
                <CardActions
                    notification={current}
                    actions={actions}
                    onActionInvoked={onActionInvoked}
                />
            ) : null}
        </Gtk.Box>
    );

    return (
        <Adw.Clamp
            widthRequest={variant === 'popup' ? 360 : -1}
            maximumSize={variant === 'popup' ? 360 : 10000}
            tighteningThreshold={variant === 'popup' ? 360 : 10000}
            hexpand
        >
            <Gtk.Box
                name={current().id.toString()}
                cssClasses={['card', 'vertical']}
                css={variant === 'popup' ? 'background-color: @window_bg_color;' : ''}
                orientation={Gtk.Orientation.VERTICAL}
                ref={(self) => {
                    card = self;
                    const motion = Gtk.EventControllerMotion.new();
                    motion.connect('enter', () => {
                        setHovered(true);
                        pauseDismiss?.();
                    });
                    motion.connect('leave', () => {
                        setHovered(false);
                        resumeDismiss?.();
                    });
                    self.add_controller(motion);
                    const focus = Gtk.EventControllerFocus.new();
                    focus.connect('enter', () => setFocused(true));
                    focus.connect('leave', () => setFocused(false));
                    self.add_controller(focus);
                }}
            >
                <Gtk.Box
                    spacing={8}
                    marginTop={COMPACT_SURFACE_PADDING}
                    marginBottom={COMPACT_SURFACE_PADDING}
                    marginStart={COMPACT_SURFACE_PADDING}
                    marginEnd={COMPACT_SURFACE_PADDING}
                >
                    <Gtk.Box
                        visible={critical}
                        cssClasses={['error', 'vertical']}
                        css="background-color: @error_color;"
                        orientation={Gtk.Orientation.VERTICAL}
                        widthRequest={3}
                    />
                    {maxHeight ? (
                        <Gtk.ScrolledWindow
                            propagateNaturalHeight
                            maxContentHeight={maxHeight.as((height) =>
                                Math.max(1, height - COMPACT_SURFACE_PADDING * 2)
                            )}
                            hscrollbarPolicy={Gtk.PolicyType.NEVER}
                            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                            hexpand
                        >
                            {content}
                        </Gtk.ScrolledWindow>
                    ) : content}
                </Gtk.Box>
            </Gtk.Box>
        </Adw.Clamp>
    );
};
