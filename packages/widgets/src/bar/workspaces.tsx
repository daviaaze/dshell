import type Hyprland from 'gi://AstalHyprland';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import {focusHyprlandClient, getHyprland} from '@shade/services/hyprland';
import {getAppIcon} from '@shade/services/state/apps';
import {type Accessor, bind, computed, effect, For} from 'gnim';
import {setAccessibleName} from '../common/iconButton';

/** Hyprland gives special workspaces negative ids (`special` = -99, named ones -98, -97, …). */
function specialName(ws: Hyprland.Workspace): string | null {
    if (ws.id >= 0) return null;
    const name = (ws.name ?? '').replace(/^special:?/, '');
    return name || 'special';
}
export function bindWorkspaceClientIcon(
    client: Hyprland.Client,
    resolveIcon: (client: Hyprland.Client) => string = getAppIcon
): Accessor<string> {
    const clientClass = bind(client, 'class');
    const clientTitle = bind(client, 'title');
    const initialClass = bind(client, 'initial-class');
    const initialTitle = bind(client, 'initial-title');

    return computed(() => {
        clientClass();
        clientTitle();
        initialClass();
        initialTitle();
        return resolveIcon(client);
    });
}

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
            orientation={vertical.as((v) =>
                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
            )}
            spacing={8}
        >
            <For
                each={bind(hyprland, 'workspaces').as((ws) =>
                    ws.filter((ws) => ws.get_monitor() === monitor).sort((a, b) => a.id - b.id)
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
                        return clients.some((c) => c.address === client.address)
                            ? client.address
                            : null;
                    });

                    // Special workspaces (scratchpads) are labelled by name and only
                    // shown while they hold windows: Hyprland keeps an empty one
                    // around while it is toggled open, which would leave a stray entry.
                    const special = specialName(ws);
                    const label = special ? special.charAt(0).toUpperCase() : String(ws.id);
                    const tooltip = special
                        ? `${special.charAt(0).toUpperCase()}${special.slice(1)} (área de trabalho especial)`
                        : `Área de trabalho ${ws.id}`;
                    const shownWorkspace = bind(
                        monitor,
                        special ? 'special-workspace' : 'active-workspace'
                    );
                    const isShown = computed(() => shownWorkspace() === ws);
                    const switchWorkspace = () =>
                        hyprland.dispatch(
                            special
                                ? `hl.dsp.workspace.toggle_special(${JSON.stringify(special)})`
                                : `hl.dsp.focus({workspace=${JSON.stringify(String(ws.id))}})`,
                            ''
                        );

                    return (
                        <Gtk.Box
                            visible={
                                special
                                    ? wsClients.as((clients) => toArray(clients).length > 0)
                                    : true
                            }
                            orientation={vertical.as((v) =>
                                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                            )}
                            spacing={4}
                        >
                            <Gtk.ToggleButton
                                active={isShown}
                                onClicked={(self) => {
                                    switchWorkspace();
                                    self.active = isShown();
                                }}
                                cssClasses={['flat', 'numeric', ...(special ? ['accent'] : [])]}
                                tooltipText={tooltip}
                                ref={setAccessibleName(tooltip)}
                            >
                                <Gtk.Label label={label} />
                            </Gtk.ToggleButton>
                            <For each={bind(ws, 'clients')}>
                                {(client: Hyprland.Client) => {
                                    const iconName = bindWorkspaceClientIcon(client);
                                    const clientTitle = bind(client, 'title');
                                    const clientClass = bind(client, 'class');
                                    const clientLabel = computed(
                                        () => clientTitle() || clientClass() || 'Janela'
                                    );

                                    return (
                                        <Gtk.ToggleButton
                                            active={computed(() => activeName() === client.address)}
                                            onClicked={() => focusHyprlandClient(client)}
                                            cssClasses={['flat']}
                                            tooltipText={clientLabel}
                                            ref={(self) =>
                                                effect(() => setAccessibleName(clientLabel())(self))
                                            }
                                        >
                                            <Gtk.Image iconName={iconName} pixelSize={24} />
                                        </Gtk.ToggleButton>
                                    );
                                }}
                            </For>
                        </Gtk.Box>
                    );
                }}
            </For>
        </Gtk.Box>
    );
};
