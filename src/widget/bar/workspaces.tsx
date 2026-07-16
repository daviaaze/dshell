import Hyprland from 'gi://AstalHyprland';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createComputed, For, Accessor, With} from 'gnim';
import {toArray} from '#/lib/core/gjsUtils';
import {getAppIcon} from '#/lib/services/state/apps';

export default ({
    monitor,
    vertical,
    visible = true,
}: {
    monitor: Hyprland.Monitor;
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const hyprland = Hyprland.get_default();

    return (
        <Gtk.Box
            visible={visible}
            orientation={vertical.as(v =>
                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
            )}
            spacing={8}
        >
            <For
                each={createBinding(hyprland, 'workspaces').as(ws =>
                    ws
                        .filter(ws => ws.get_monitor() === monitor)
                        .sort((a, b) => a.id - b.id)
                )}
            >
                {(ws: Hyprland.Workspace) => {
                    // Guard against race condition: only set activeName if the
                    // client toggle actually exists in this workspace's group.
                    const focusedClient = createBinding(hyprland, 'focusedClient');
                    const wsClients = createBinding(ws, 'clients');

                    return (
                    <Adw.ToggleGroup
                        orientation={vertical.as(v =>
                            v
                                ? Gtk.Orientation.VERTICAL
                                : Gtk.Orientation.HORIZONTAL
                        )}
                        cssClasses={[ws.id < 0 ? 'success' : '']}
                        activeName={createComputed(() => {
                            const client = focusedClient();
                            if (!client || client.workspace !== ws)
                                return null as unknown as string;
                            const clients = toArray<Hyprland.Client>(wsClients());
                            return clients.some(c => c.address === client.address)
                                ? client.address
                                : (null as unknown as string);
                        })}
                    >
                        <For
                            each={createBinding(ws, 'clients').as(clients =>
                                toArray<Hyprland.Client>(clients)
                            )}
                        >
                            {(client: Hyprland.Client) => (
                                <Adw.Toggle
                                    name={client.address}
                                    child={
                                        (
                                            <Gtk.Image
                                                iconName={getAppIcon(client)}
                                                pixelSize={24}
                                            >
                                                <Gtk.GestureClick
                                                    onPressed={() =>
                                                        client.focus()
                                                    }
                                                />
                                            </Gtk.Image>
                                        ) as Gtk.Widget
                                    }
                                />
                            )}
                        </For>
                        {/* create toggle when ws is empty */}
                        <With
                            value={createBinding(ws, 'clients').as(
                                clients =>
                                    toArray<Hyprland.Client>(clients).length < 1
                            )}
                        >
                            {(isEmpty: boolean) =>
                                isEmpty ? <Adw.Toggle /> : null
                            }
                        </With>
                    </Adw.ToggleGroup>
                    );
                }}
            </For>
        </Gtk.Box>
    ) as Gtk.Box;
};
