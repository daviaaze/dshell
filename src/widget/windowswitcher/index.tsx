// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {createBinding, createState, For, onCleanup} from 'gnim';
import {app} from '#/apps/shell/App';
import {toArray} from '#/lib/core/gjsUtils';
import SwitcherItem from './item';
import logger from '#/lib/core/logger';

let switcherWindow: Astal.Window | null = null;

export const toggleWindowSwitcher = () => {
    if (switcherWindow) {
        const nextVisible = !switcherWindow.visible;
        logger.debug('wm', `windowSwitcher ${nextVisible ? 'shown' : 'hidden'}`);
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

export default () => {
    const hyprland = AstalHyprland.get_default();
    const [selectedIndex, setSelectedIndex] = createState(0);

    let mru: string[] = [];

    const updateMru = (client: AstalHyprland.Client | null) => {
        if (!client || client.address === '0x0') return;
        mru = mru.filter(addr => addr !== client.address);
        mru.unshift(client.address);
    };

    const mruUnsubscribe = createBinding(hyprland, 'focusedClient').subscribe(
        (client: any) => updateMru(client)
    );

    const clientsBinding = createBinding(hyprland, 'clients');
    const clientsList = clientsBinding.as(c => getSortedClients(c, mru));

    const clampUnsubscribe = clientsList.subscribe(() => {
        const len = (clientsList() as any)?.length ?? 0;
        if (selectedIndex() >= len) {
            setSelectedIndex(Math.max(0, len - 1));
        }
    });

    let superReleased = false;

    const closeSwitcher = () => {
        if (switcherWindow) {
            switcherWindow.visible = false;
        }
        superReleased = false;
    };

    const doFocus = (client: AstalHyprland.Client) => {
        client.focus();
        closeSwitcher();
    };

    const handleKeyPressed = (
        _: Gtk.EventControllerKey,
        keyval: number
    ): boolean => {
        const clients = clientsList() ?? [];

        // Group keys by action, then build a flat lookup table
        const keyGroups: [number[], () => boolean][] = [
            [
                [Gdk.KEY_Tab, Gdk.KEY_Right],
                () => {
                    if (clients.length > 0)
                        setSelectedIndex(i => (i + 1) % clients.length);
                    return true;
                },
            ],
            [
                [Gdk.KEY_ISO_Left_Tab, Gdk.KEY_Left],
                () => {
                    if (clients.length > 0)
                        setSelectedIndex(
                            i => (i - 1 + clients.length) % clients.length
                        );
                    return true;
                },
            ],
            [
                [Gdk.KEY_Return, Gdk.KEY_KP_Enter],
                () => {
                    if (clients[selectedIndex()])
                        doFocus(clients[selectedIndex()]);
                    return true;
                },
            ],
            [
                [Gdk.KEY_Escape],
                () => {
                    closeSwitcher();
                    return true;
                },
            ],
            [
                [Gdk.KEY_q, Gdk.KEY_Q],
                () => {
                    if (clients[selectedIndex()])
                        clients[selectedIndex()].kill();
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
                () => {
                    return false;
                },
            ],
        ];

        const keyActions: Record<number, () => boolean> = {};
        for (const [keys, action] of keyGroups) {
            for (const key of keys) keyActions[key] = action;
        }

        const action = keyActions[keyval];
        return action ? action() : false;
    };

    const handleKeyReleased = (
        _: Gtk.EventControllerKey,
        keyval: number
    ): boolean => {
        if (
            (keyval === Gdk.KEY_Super_L ||
                keyval === Gdk.KEY_Super_R ||
                keyval === Gdk.KEY_Meta_L ||
                keyval === Gdk.KEY_Meta_R) &&
            !superReleased
        ) {
            superReleased = true;
            const clients = clientsList() ?? [];
            if (clients[selectedIndex()]) {
                doFocus(clients[selectedIndex()]);
            } else {
                closeSwitcher();
            }
            return true;
        }
        return false;
    };

    let boxRef: Gtk.Box | null = null;

    const onOpen = () => {
        const clients = clientsList() ?? [];
        setSelectedIndex(clients.length > 1 ? 1 : 0);
        superReleased = false;
        boxRef?.grab_focus();
    };

    return (
        <Astal.Window
            $={self => {
                switcherWindow = self;
                onCleanup(() => {
                    switcherWindow = null;
                    mruUnsubscribe();
                    clampUnsubscribe();
                });
            }}
            name={'windowswitcher'}
            application={app}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.EXCLUSIVE}
            visible={false}
            onNotifyVisible={self => {
                if (self.visible) onOpen();
            }}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            monitor={createBinding(hyprland, 'focusedMonitor').as(m => m.id)}
            css={'background-color: transparent;'}
        >
            <Gtk.Box
                $={self => {
                    boxRef = self;
                }}
                focusable
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                widthRequest={500}
            >
                <Gtk.EventControllerKey
                    $={self => {
                        self.connect('key-pressed', handleKeyPressed);
                        self.connect('key-released', handleKeyReleased);
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
