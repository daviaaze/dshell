import Hyprland from 'gi://AstalHyprland';
import {getHyprland} from '@shade/services/hyprland';
import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, For, Accessor, With} from 'gnim';
import {toArray} from '@shade/core/gjsUtils';
import {getAppIcon} from '@shade/services/state/apps';

export default ({
    monitor,
    vertical,
    visible = true,
}: {
    monitor: Hyprland.Monitor;
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const hyprland = getHyprland();
    if (!hyprland) return null;

    return (
        <Gtk.Box
            visible={visible}
            orientation={vertical.as(v =>
                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
            )}
            spacing={8}
        >
            <For
                each={bind(hyprland, 'workspaces').as(ws =>
                    ws
                        .filter(ws => ws.get_monitor() === monitor)
                        .sort((a, b) => a.id - b.id)
                )}
            >
                {(ws: Hyprland.Workspace) => {
                    // Guard against race condition: only set activeName if the
                    // client toggle actually exists in this workspace's group.
                    const focusedClient = bind(hyprland, 'focused-client');
                    const wsClients = bind(ws, 'clients');

                    const activeName = computed(() => {
                        const client = focusedClient();

                        if (!client || client.workspace !== ws) return null;

                        const clients = toArray<Hyprland.Client>(wsClients());
                        return clients.some(c => c.address === client.address)
                            ? client.address
                            : null;
                    });

                    return (
                        <Gtk.Box
                            orientation={vertical.as(v =>
                                v
                                    ? Gtk.Orientation.VERTICAL
                                    : Gtk.Orientation.HORIZONTAL
                            )}
                            spacing={4}
                        >
                            <For
                                each={bind(ws, 'clients').as(clients =>
                                    toArray<Hyprland.Client>(clients)
                                )}
                            >
                                {(client: Hyprland.Client) => (
                                    <Gtk.ToggleButton
                                        active={computed(
                                            () =>
                                                activeName() ===
                                                client.address
                                        )}
                                        onClicked={() => client.focus()}
                                        cssClasses={['flat']}
                                    >
                                        <Gtk.Image
                                            iconName={getAppIcon(client)}
                                            pixelSize={24}
                                        />
                                    </Gtk.ToggleButton>
                                )}
                            </For>
                            {/* show empty dot when ws is empty */}
                            <With
                                value={bind(ws, 'clients').as(
                                    clients =>
                                        toArray<Hyprland.Client>(clients)
                                            .length < 1
                                )}
                            >
                                {(isEmpty: boolean) =>
                                    isEmpty ? (
                                        <Gtk.ToggleButton
                                            active={false}
                                            cssClasses={['flat']}
                                        >
                                            <Gtk.Image
                                                iconName={
                                                    'window-minimize-symbolic'
                                                }
                                                pixelSize={8}
                                            />
                                        </Gtk.ToggleButton>
                                    ) : null
                                }
                            </With>
                        </Gtk.Box>
                    );
                }}
            </For>
        </Gtk.Box>
    );
};
