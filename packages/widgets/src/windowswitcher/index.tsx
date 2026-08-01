import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {getHyprland} from '@shade/services/hyprland';
import {Accessor, bind, createState, For, onCleanup, Setter} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import {toArray} from '@shade/core/gjsUtils';
import SwitcherItem from './item';
import logger from '@shade/core/logger';

let switcherWindow: Astal.Window | null = null;

export const toggleWindowSwitcher = () => {
    if (switcherWindow) {
        const nextVisible = !switcherWindow.visible;
        logger.debug(
            'wm',
            `windowSwitcher ${nextVisible ? 'shown' : 'hidden'}`
        );
        switcherWindow.visible = nextVisible;
    } else {
        logger.debug('wm', 'windowSwitcher toggled (no window yet)');
    }
};

const getSortedClients = (
    clients: AstalHyprland.Client[],
    mru: string[]
): AstalHyprland.Client[] => {
    const arr = toArray<AstalHyprland.Client>(clients);
    const sorted = mru
        .map(addr => arr.find(c => c.address === addr))
        .filter((c): c is AstalHyprland.Client => c !== undefined);
    const newClients = arr.filter(c => !mru.includes(c.address));
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
    client.focus();
    closeSwitcher(state);
}

/** Flat key → action lookup, built from grouped key bindings. */
function buildKeyActions(
    state: SwitcherState
): Record<number, () => boolean> {
    const clients = state.clientsList() ?? [];

    const keyGroups: [number[], () => boolean][] = [
        [
            [Gdk.KEY_Tab, Gdk.KEY_Right],
            () => {
                if (clients.length > 0)
                    state.setSelectedIndex(i => (i + 1) % clients.length);
                return true;
            },
        ],
        [
            [Gdk.KEY_ISO_Left_Tab, Gdk.KEY_Left],
            () => {
                if (clients.length > 0)
                    state.setSelectedIndex(
                        i => (i - 1 + clients.length) % clients.length
                    );
                return true;
            },
        ],
        [
            [Gdk.KEY_Return, Gdk.KEY_KP_Enter],
            () => {
                if (clients[state.selectedIndex()])
                    doFocus(state, clients[state.selectedIndex()]);
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
                    clients[state.selectedIndex()].kill();
                return true;
            },
        ],
        [
            [
                Gdk.KEY_Super_L,
                Gdk.KEY_Super_R,
                Gdk.KEY_Meta_L,
                Gdk.KEY_Meta_R,
            ],
            () => false,
        ],
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
    state.boxRef.current?.grab_focus();
}

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const [selectedIndex, setSelectedIndex] = createState(0);

    let mru: string[] = [];

    const updateMru = (client: AstalHyprland.Client | null) => {
        if (!client || client.address === '0x0') return;
        mru = mru.filter(addr => addr !== client.address);
        mru.unshift(client.address);
    };

    const focusedClient = bind(hyprland, 'focused-client');

    const focusedClientUnsubscribe = focusedClient.subscribe(() => {
        updateMru(focusedClient());
    });

    const clientsBinding = bind(hyprland, 'clients');
    const clientsList = clientsBinding.as(c => getSortedClients(c, mru));

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
            ref={self => {
                switcherWindow = self;
                onCleanup(() => {
                    switcherWindow = null;
                    focusedClientUnsubscribe();
                    clampUnsubscribe();
                });
            }}
            name={'windowswitcher'}
            application={getApp()}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.EXCLUSIVE}
            visible={false}
            onNotifyVisible={self => {
                if (self.visible) onOpen(state);
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={bind(hyprland, 'focused-monitor').as(m => m.id)}
            css={'background-color: transparent;'}
        >
            <Gtk.Box
                ref={self => {
                    state.boxRef.current = self;
                }}
                focusable
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                widthRequest={500}
            >
                <Gtk.EventControllerKey
                    ref={self => {
                        self.connect('key-pressed', (_c, keyval) =>
                            handleKeyPressed(state, keyval)
                        );
                        self.connect('key-released', (_c, keyval) =>
                            handleKeyReleased(state, keyval)
                        );
                    }}
                />
                <For each={clientsList}>
                    {(client: AstalHyprland.Client) => (
                        <SwitcherItem
                            client={client}
                            selected={selectedIndex.as(idx => {
                                const clients = clientsList() ?? [];
                                return clients[idx]?.address === client.address;
                            })}
                        />
                    )}
                </For>
                <Adw.StatusPage
                    visible={clientsList.as(l => l.length === 0)}
                    vexpand
                    cssClasses={['compact']}
                    title="No Open Windows"
                    iconName="window-new-symbolic"
                />
            </Gtk.Box>
        </Astal.Window>
    );
};