import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {closeHyprlandClient, focusHyprlandClient, getHyprland} from '@shade/services/hyprland';
import ShellState from '@shade/services/state/shellState';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, computed, createState, For, onCleanup, type Setter} from 'gnim';
import {
    OPAQUE_SURFACE_CSS,
    SURFACE_EDGE_GAP,
    SURFACE_PADDING,
    SURFACE_SPACING,
} from '../common/surface';
import SwitcherItem from './item';

let switcherWindow: Astal.Window | null = null;
let reconcileSwitcherMru: (() => void) | null = null;

export const toggleWindowSwitcher = () => {
    if (switcherWindow) {
        const nextVisible = !switcherWindow.visible;
        // The switcher lists window titles; never map it over a locked session.
        if (nextVisible && ShellState.get_default().screenlocked) return;
        logger.debug('wm', `windowSwitcher ${nextVisible ? 'shown' : 'hidden'}`);
        // Read the latest client before mapping the exclusive layer can take focus.
        if (nextVisible) reconcileSwitcherMru?.();
        switcherWindow.visible = nextVisible;
    } else {
        logger.debug('wm', 'windowSwitcher toggled (no window yet)');
    }
};

export const hideWindowSwitcher = () => {
    if (switcherWindow) switcherWindow.visible = false;
};

const getSortedClients = (
    clients: AstalHyprland.Client[],
    mru: string[]
): AstalHyprland.Client[] => {
    const arr = toArray<AstalHyprland.Client>(clients);
    const sorted = mru
        .map((addr) => arr.find((c) => c.address === addr))
        .filter((c): c is AstalHyprland.Client => c !== undefined);
    const newClients = arr.filter((c) => !mru.includes(c.address));
    return [...sorted, ...newClients];
};

/** Mutable switcher state shared by the keyboard handlers. */
interface SwitcherState {
    clientsList: Accessor<AstalHyprland.Client[]>;
    selectedIndex: Accessor<number>;
    setSelectedIndex: Setter<number>;
    superReleased: boolean;
    boxRef: {current: Gtk.Box | null};
}

function closeSwitcher(state: SwitcherState) {
    if (switcherWindow) {
        switcherWindow.visible = false;
    }
    state.superReleased = false;
}

function doFocus(state: SwitcherState, client: AstalHyprland.Client) {
    // Release the layer grab before Hyprland processes client-focus IPC.
    closeSwitcher(state);
    switcherWindow?.get_display().flush();
    focusHyprlandClient(client);
}

/** Flat key → action lookup, built from grouped key bindings. */
function buildKeyActions(state: SwitcherState): Record<number, () => boolean> {
    const clients = state.clientsList() ?? [];

    const keyGroups: [number[], () => boolean][] = [
        [
            [Gdk.KEY_Tab, Gdk.KEY_Right, Gdk.KEY_Down],
            () => {
                if (clients.length > 0) state.setSelectedIndex((i) => (i + 1) % clients.length);
                return true;
            },
        ],
        [
            [Gdk.KEY_ISO_Left_Tab, Gdk.KEY_Left, Gdk.KEY_Up],
            () => {
                if (clients.length > 0)
                    state.setSelectedIndex((i) => (i - 1 + clients.length) % clients.length);
                return true;
            },
        ],
        [
            [Gdk.KEY_Return, Gdk.KEY_KP_Enter],
            () => {
                if (clients[state.selectedIndex()]) doFocus(state, clients[state.selectedIndex()]);
                return true;
            },
        ],
        [
            [Gdk.KEY_Escape],
            () => {
                closeSwitcher(state);
                return true;
            },
        ],
        [
            [Gdk.KEY_q, Gdk.KEY_Q],
            () => {
                if (clients[state.selectedIndex()])
                    closeHyprlandClient(clients[state.selectedIndex()]);
                return true;
            },
        ],
        [[Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R], () => false],
    ];

    const keyActions: Record<number, () => boolean> = {};
    for (const [keys, action] of keyGroups) {
        for (const key of keys) keyActions[key] = action;
    }
    return keyActions;
}

function handleKeyPressed(state: SwitcherState, keyval: number): boolean {
    const action = buildKeyActions(state)[keyval];
    return action ? action() : false;
}

function handleKeyReleased(state: SwitcherState, keyval: number): boolean {
    const isSuper =
        keyval === Gdk.KEY_Super_L ||
        keyval === Gdk.KEY_Super_R ||
        keyval === Gdk.KEY_Meta_L ||
        keyval === Gdk.KEY_Meta_R;
    if (isSuper && !state.superReleased) {
        state.superReleased = true;
        const clients = state.clientsList() ?? [];
        if (clients[state.selectedIndex()]) {
            doFocus(state, clients[state.selectedIndex()]);
        } else {
            closeSwitcher(state);
        }
        return true;
    }
    return false;
}

function onOpen(state: SwitcherState) {
    const clients = state.clientsList() ?? [];
    state.setSelectedIndex(clients.length > 1 ? 1 : 0);
    state.superReleased = false;
    switcherWindow?.present();
    state.boxRef.current?.grab_focus();
}

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const focusedMonitor = bind(hyprland, 'focused-monitor');
    const panelWidth = computed(() => {
        const monitor = focusedMonitor();
        return monitor
            ? Math.max(1, Math.min(500, monitor.width / (monitor.scale || 1) - 32))
            : 500;
    });
    const keyHint = new Gtk.Label({
        label: 'Tab/↑↓ alternar · Enter focar · Q fechar · Esc cancelar',
        cssClasses: ['caption', 'dimmed'],
        ellipsize: Pango.EllipsizeMode.END,
    });
    const keyHintHeight = keyHint.measure(Gtk.Orientation.VERTICAL, -1)[1];
    // Output height minus the edge gaps, the card padding and the hint row.
    const panelHeight = computed(() => {
        const monitor = focusedMonitor();
        const logical = monitor ? monitor.height / (monitor.scale || 1) : 600;
        return Math.max(
            1,
            logical - SURFACE_EDGE_GAP * 2 - SURFACE_PADDING * 2 - SURFACE_SPACING - keyHintHeight
        );
    });

    const [selectedIndex, setSelectedIndex] = createState(0);
    const [mru, setMru] = createState<string[]>([]);

    const updateMru = (client: AstalHyprland.Client | null) => {
        if (!client || !client.address || client.address === '0x0') return;
        setMru((current) => {
            const next = current.filter((addr) => addr !== client.address);
            next.unshift(client.address);
            return next;
        });
    };

    const focusedClient = bind(hyprland, 'focused-client');

    const focusedClientUnsubscribe = focusedClient.subscribe(() => {
        updateMru(focusedClient());
    });
    updateMru(focusedClient());

    const clientsBinding = bind(hyprland, 'clients');
    const clientsList = computed(() => getSortedClients(clientsBinding(), mru()));

    const clampUnsubscribe = clientsList.subscribe(() => {
        const len = clientsList()?.length ?? 0;
        if (selectedIndex() >= len) {
            setSelectedIndex(Math.max(0, len - 1));
        }
    });

    const state: SwitcherState = {
        clientsList,
        selectedIndex,
        setSelectedIndex,
        superReleased: false,
        boxRef: {current: null},
    };

    return (
        <Astal.Window
            ref={(self) => {
                reconcileSwitcherMru = () => updateMru(focusedClient());
                switcherWindow = self;
                const keys = new Gtk.EventControllerKey({
                    propagationPhase: Gtk.PropagationPhase.CAPTURE,
                });
                keys.connect('key-pressed', (_controller, keyval) =>
                    handleKeyPressed(state, keyval)
                );
                keys.connect('key-released', (_controller, keyval) =>
                    handleKeyReleased(state, keyval)
                );
                self.add_controller(keys);
                // The window covers the whole output: a press outside the card dismisses it.
                const click = new Gtk.GestureClick();
                click.connect('pressed', (_gesture, _presses, x, y) => {
                    const target = self.pick(x, y, Gtk.PickFlags.DEFAULT);
                    if (!target || target === self) closeSwitcher(state);
                });
                self.add_controller(click);
                onCleanup(() => {
                    self.remove_controller(keys);
                    self.remove_controller(click);
                    switcherWindow = null;
                    reconcileSwitcherMru = null;
                    focusedClientUnsubscribe();
                    clampUnsubscribe();
                });
            }}
            name={'windowswitcher'}
            application={getApp()}
            namespace={'shade-switcher'}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.EXCLUSIVE}
            visible={false}
            onMap={() => onOpen(state)}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={focusedMonitor.as((m) => monitorIndexFromHyprland(m))}
            css="background-color: transparent;"
        >
            <Gtk.Box
                ref={(self) => {
                    state.boxRef.current = self;
                }}
                focusable
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={SURFACE_SPACING}
                widthRequest={panelWidth}
                cssClasses={['card', 'background']}
                css={`${OPAQUE_SURFACE_CSS} padding: ${SURFACE_PADDING}px;`}
            >
                <Gtk.ScrolledWindow
                    propagateNaturalHeight
                    maxContentWidth={panelWidth}
                    maxContentHeight={panelHeight}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                    vexpand
                >
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <For each={clientsList}>
                            {(client: AstalHyprland.Client, index) => (
                                <SwitcherItem
                                    client={client}
                                    selected={computed(() => index() === selectedIndex())}
                                />
                            )}
                        </For>
                        <Adw.StatusPage
                            visible={clientsList.as((l) => l.length === 0)}
                            vexpand
                            cssClasses={['compact']}
                            title="Nenhuma janela aberta"
                            description="Pressione Esc para fechar o seletor."
                            iconName="window-new-symbolic"
                        />
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
                {keyHint}
            </Gtk.Box>
        </Astal.Window>
    );
};
