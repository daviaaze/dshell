import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import type Notifd from 'gi://AstalNotifd';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {IconNames} from '@shade/core/iconNames';
import {bus} from '@shade/services/bus';
import DndService from '@shade/services/notifications/dnd';
import type {HistoryEntry} from '@shade/services/notifications/history';
import NotificationHistory from '@shade/services/notifications/history';
import {useNotifd} from '@shade/services/notifications/useNotifd';
import {type Accessor, bind, computed, createState, effect, For, type Setter} from 'gnim';
import Notification from '../common/notification';
import {escapeNotificationMarkup} from '../common/notificationModel';

const HISTORY_PAGE_SIZE = 20;
const historyClearDialogs = new WeakSet<Gtk.Window>();

export const isHistoryClearDialogOpen = (window: Gtk.Window) => historyClearDialogs.has(window);

function accessibleLabel(widget: Gtk.Widget, label: string) {
    widget.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [new GObject.Value(GObject.TYPE_STRING, label)]
    );
}

/** Native switch semantics and the stable name are consumed by VM accessibility scripts. */
export const NotificationDndControl = () => {
    const dnd = DndService.get_default();
    return (
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
            <Gtk.Label label="Não perturbe" cssClasses={['caption']} />
            <Gtk.Switch
                valign={Gtk.Align.CENTER}
                active={bind(dnd, 'dnd')}
                onNotifyActive={(self) => {
                    if (self.active === dnd.dnd) return;
                    try {
                        bus.emit('system:dnd:set', self.active);
                    } finally {
                        self.active = dnd.dnd;
                    }
                }}
                ref={(self) => accessibleLabel(self, 'Não perturbe')}
            />
        </Gtk.Box>
    );
};

/** Stable app-name keys avoid rebuilding unaffected groups during dismissal. */
function newestFirst(notifications: Notifd.Notification[]): Notifd.Notification[] {
    return [...notifications].sort((a, b) => b.time - a.time);
}

function appOrder(notifications: Notifd.Notification[]): string[] {
    return [...new Set(newestFirst(notifications).map((notification) => notification.appName))];
}

/** Dismiss outside the daemon's signal emission. */
function dismissAll(notifications: Notifd.Notification[]): void {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        for (const notification of notifications) notification.dismiss();
        return GLib.SOURCE_REMOVE;
    });
}

/** Absolute history timestamps retain the clock time even for older entries. */
function historyTime(unix: number): string {
    const date = GLib.DateTime.new_from_unix_local(unix)!;
    const now = GLib.DateTime.new_now_local()!;
    const sameDay = date.get_year() === now.get_year() &&
        date.get_day_of_year() === now.get_day_of_year();
    if (sameDay) return date.format('%H:%M') || '';
    return date.format(date.get_year() === now.get_year() ? '%d %b %H:%M' : '%d %b %Y %H:%M') || '';
}

/** Mounted only once Notifd is available, avoiding foreign-daemon proxy timeouts. */
const NotificationListContent = ({
    notifd,
    history,
    showHistory,
    setShowHistory,
}: {
    notifd: Notifd.Notifd;
    history: NotificationHistory;
    showHistory: Accessor<boolean>;
    setShowHistory: Setter<boolean>;
}) => {
    const entries = bind(history, 'history');
    const active = bind(notifd, 'notifications');
    const [historyCount, setHistoryCount] = createState(HISTORY_PAGE_SIZE);

    const clearHistory = (parent: Gtk.Widget) => {
        const root = parent.get_root();
        if (!(root instanceof Gtk.Window)) return;
        historyClearDialogs.add(root);
        const dialog = new Adw.AlertDialog({
            heading: 'Limpar histórico de notificações?',
            body: 'Isso remove permanentemente todas as notificações salvas e não altera o modo Não perturbe.',
            defaultResponse: 'cancel',
            closeResponse: 'cancel',
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('clear', 'Limpar histórico');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        const astalRoot = root instanceof Astal.Window ? root : null;
        const previousKeymode = astalRoot?.keymode;
        if (astalRoot) astalRoot.keymode = Astal.Keymode.NONE;
        dialog.connect('closed', () => {
            historyClearDialogs.delete(root);
            if (astalRoot && previousKeymode !== undefined) astalRoot.keymode = previousKeymode;
        });
        dialog.connect('response', (_dialog, response) => {
            if (response === 'clear') history.clear();
        });
        root.present();
        dialog.present(root);
    };

    const Actions = () => (
        <Gtk.Box spacing={8}>
            <Gtk.Button onClicked={() => setShowHistory(!showHistory())}>
                <Adw.ButtonContent
                    iconName={showHistory.as((value) =>
                        value ? IconNames.goPrevious : IconNames.documentOpenRecent
                    )}
                    label={showHistory.as((value) =>
                        value ? 'Voltar às notificações' : 'Histórico'
                    )}
                />
            </Gtk.Button>
            <Gtk.Box hexpand />
            <Gtk.Button
                visible={showHistory}
                label="Limpar histórico"
                cssClasses={['destructive-action']}
                sensitive={entries.as((items) => items.length > 0)}
                onClicked={(self) => clearHistory(self)}
            />
            <Gtk.Button
                visible={showHistory.as((value) => !value)}
                label="Dispensar todas"
                cssClasses={['destructive-action']}
                sensitive={active.as((items) => items.length > 0)}
                onClicked={() => dismissAll(notifd.get_notifications())}
            />
        </Gtk.Box>
    );

    const HistoryItem = ({entry}: {entry: HistoryEntry}) => {
        const [expanded, setExpanded] = createState(false);
        return (
            <Gtk.ListBoxRow activatable={false}>
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    marginTop={8}
                    marginBottom={8}
                    marginStart={8}
                    marginEnd={8}
                >
                    <Gtk.Box spacing={8}>
                        <Gtk.Image
                            pixelSize={16}
                            iconName={entry.appIcon || IconNames.dialogInformation}
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'dimmed']}
                            useMarkup
                            label={escapeNotificationMarkup(entry.appName || 'Notificação')}
                            ellipsize={Pango.EllipsizeMode.END}
                            widthChars={1}
                            maxWidthChars={24}
                            hexpand
                            xalign={0}
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'dimmed', 'numeric']}
                            label={historyTime(entry.time)}
                        />
                        <Gtk.Button
                            visible={!!entry.body}
                            cssClasses={['flat', 'circular']}
                            iconName={expanded.as((value) => value ? IconNames.goUp : IconNames.goDown)}
                            tooltipText={expanded.as((value) =>
                                value ? 'Ocultar mensagem completa' : 'Mostrar mensagem completa'
                            )}
                            onClicked={() => setExpanded(!expanded())}
                            ref={(self) =>
                                effect(() => accessibleLabel(
                                    self,
                                    expanded() ? 'Ocultar mensagem completa' : 'Mostrar mensagem completa'
                                ))
                            }
                        />
                        <Gtk.Button
                            cssClasses={['flat', 'circular', 'destructive-action']}
                            iconName={IconNames.editDelete}
                            tooltipText="Excluir do histórico"
                            onClicked={() => history.remove(entry.id)}
                            ref={(self) => accessibleLabel(self, 'Excluir do histórico')}
                        />
                    </Gtk.Box>
                    <Gtk.Label
                        cssClasses={['heading']}
                        useMarkup
                        label={escapeNotificationMarkup(entry.summary || 'Notificação')}
                        tooltipText={entry.summary}
                        wrap
                        wrapMode={Pango.WrapMode.WORD_CHAR}
                        lines={2}
                        ellipsize={Pango.EllipsizeMode.END}
                        widthChars={1}
                        maxWidthChars={40}
                        hexpand
                        xalign={0}
                    />
                    <Gtk.Label
                        visible={!!entry.body}
                        cssClasses={['body']}
                        useMarkup
                        label={escapeNotificationMarkup(entry.body || '')}
                        wrap
                        wrapMode={Pango.WrapMode.WORD_CHAR}
                        lines={expanded.as((value) => value ? -1 : 3)}
                        ellipsize={expanded.as((value) =>
                            value ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END
                        )}
                        selectable
                        widthChars={1}
                        maxWidthChars={40}
                        hexpand
                        xalign={0}
                    />
                </Gtk.Box>
            </Gtk.ListBoxRow>
        );
    };

    const HistoryView = () => (
        <Gtk.Box visible={showHistory} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <Gtk.Label label="Histórico" cssClasses={['heading']} xalign={0} />
            <Gtk.ListBox
                cssClasses={['boxed-list']}
                visible={entries.as((items) => items.length > 0)}
                selectionMode={Gtk.SelectionMode.NONE}
            >
                <For each={computed(() => entries().slice(0, historyCount()))}>
                    {(entry: HistoryEntry) => <HistoryItem entry={entry} />}
                </For>
            </Gtk.ListBox>
            <Gtk.Button
                visible={computed(() => entries().length > historyCount())}
                label="Mostrar mais"
                halign={Gtk.Align.CENTER}
                onClicked={() => setHistoryCount((count) => count + HISTORY_PAGE_SIZE)}
            />
            <Gtk.Label
                visible={computed(() => entries().length > historyCount())}
                cssClasses={['caption', 'dimmed']}
                label={computed(() =>
                    `Mostrando ${historyCount()} de ${entries().length} notificações`
                )}
                halign={Gtk.Align.CENTER}
            />
            <Adw.StatusPage
                visible={entries.as((items) => items.length === 0)}
                cssClasses={['compact']}
                title="Sem histórico"
                description="O histórico de notificações está vazio"
                iconName={IconNames.notifications}
            />
        </Gtk.Box>
    );

    const NotificationGroup = ({appName}: {appName: string}) => {
        const [expanded, setExpanded] = createState(false);
        const notifications = active.as((items) =>
            newestFirst(items.filter((notification) => notification.appName === appName))
        );
        const first = notifications.as((items) => items.slice(0, 1).map((notification) => notification.id));
        const rest = notifications.as((items) => items.slice(1).map((notification) => notification.id));
        const Item = ({id}: {id: number}) => {
            const initial = notifications().find((notification) => notification.id === id)!;
            const notification = computed(
                () => notifications().find((item) => item.id === id) ?? initial
            );
            return (
                <Notification
                    notification={notification}
                    variant="list"
                    closeAction={(current) => dismissAll([current])}
                    onDefaultAction={() => {
                        notification().invoke('default');
                        dismissAll([notification()]);
                    }}
                    onActionInvoked={() => dismissAll([notification()])}
                />
            );
        };
        return (
            <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
                <Gtk.Box spacing={8}>
                    <Gtk.Image
                        pixelSize={16}
                        iconName={notifications.as((items) =>
                            items[0]?.appIcon || IconNames.dialogInformation
                        )}
                    />
                    <Gtk.Label
                        label={appName || 'Notificação'}
                        cssClasses={['caption-heading']}
                        ellipsize={Pango.EllipsizeMode.END}
                        widthChars={1}
                        maxWidthChars={32}
                        hexpand
                        xalign={0}
                    />
                    <Gtk.Label
                        label={notifications.as((items) => `${items.length}`)}
                        cssClasses={['caption', 'dimmed', 'numeric']}
                    />
                    <Gtk.ToggleButton
                        visible={notifications.as((items) => items.length > 1)}
                        active={expanded}
                        cssClasses={['flat', 'circular']}
                        iconName={expanded.as((value) => value ? IconNames.goUp : IconNames.goDown)}
                        tooltipText={expanded.as((value) =>
                            value ? 'Recolher notificações' : 'Mostrar mais notificações'
                        )}
                        onClicked={() => setExpanded(!expanded())}
                        ref={(self) =>
                            effect(() => accessibleLabel(
                                self,
                                `${expanded() ? 'Recolher' : 'Mostrar'} notificações de ${appName || 'aplicativo'}`
                            ))
                        }
                    />
                    <Gtk.Button
                        iconName={IconNames.editClearAll}
                        valign={Gtk.Align.CENTER}
                        tooltipText="Dispensar este grupo"
                        cssClasses={['flat', 'circular', 'destructive-action']}
                        onClicked={() => dismissAll(notifications())}
                        ref={(self) => accessibleLabel(self, 'Dispensar este grupo')}
                    />
                </Gtk.Box>
                <For each={first}>
                    {(id: number) => <Item id={id} />}
                </For>
                <Gtk.Revealer revealChild={expanded}>
                    <Gtk.Box spacing={8} orientation={Gtk.Orientation.VERTICAL}>
                        <For each={rest}>
                            {(id: number) => <Item id={id} />}
                        </For>
                    </Gtk.Box>
                </Gtk.Revealer>
            </Gtk.Box>
        );
    };

    const ActiveView = () => (
        <Gtk.Box
            visible={showHistory.as((value) => !value)}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={12}
        >
            <Gtk.Label label="Ativas" cssClasses={['heading']} xalign={0} />
            <For each={active.as(appOrder)}>
                {(appName: string) => <NotificationGroup appName={appName} />}
            </For>
            <Adw.StatusPage
                visible={active.as((items) => items.length === 0)}
                cssClasses={['compact']}
                title="Sem notificações"
                description="Você está em dia."
                iconName={IconNames.notifications}
            />
        </Gtk.Box>
    );

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <Actions />
            <HistoryView />
            <ActiveView />
        </Gtk.Box>
    );
};

export const NotificationList = () => {
    const {value: notifd, resolved} = useNotifd();
    const history = NotificationHistory.get_default();
    const [showHistory, setShowHistory] = createState(false);
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <Gtk.Box
                visible={notifd.as((daemon) => daemon === null)}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={12}
                valign={Gtk.Align.CENTER}
                halign={Gtk.Align.CENTER}
                vexpand
            >
                <Gtk.Spinner spinning visible={resolved.as((value) => !value)} />
                <Gtk.Label
                    cssClasses={['heading']}
                    wrap
                    wrapMode={Pango.WrapMode.WORD_CHAR}
                    xalign={0.5}
                    label={resolved.as((value) =>
                        value ? 'Serviço de notificações indisponível' : 'Carregando notificações…'
                    )}
                />
                <Gtk.Label
                    visible={resolved}
                    wrap
                    wrapMode={Pango.WrapMode.WORD_CHAR}
                    xalign={0.5}
                    maxWidthChars={40}
                    cssClasses={['dimmed']}
                    label="Verifique o serviço de notificações da sessão. Outro aplicativo pode estar gerenciando os avisos."
                />
            </Gtk.Box>
            <For each={notifd.as((daemon) => daemon ? [daemon] : [])}>
                {(daemon: Notifd.Notifd) => (
                    <NotificationListContent
                        notifd={daemon}
                        history={history}
                        showHistory={showHistory}
                        setShowHistory={setShowHistory}
                    />
                )}
            </For>
        </Gtk.Box>
    );
};
