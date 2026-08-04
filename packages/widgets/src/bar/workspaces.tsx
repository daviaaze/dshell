import type Hyprland from 'gi://AstalHyprland';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import {getHyprland} from '@shade/services/hyprland';
import {getAppIcon} from '@shade/services/state/apps';
import {useStyle} from '@shade/style/useStyle';
import {type Accessor, bind, computed, For, With} from 'gnim';

const SPECIAL_WORKSPACE_ID = -99;

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
            <For each={bind(hyprland, 'workspaces')}>
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

                    // Special workspace gets a distinct background
                    const isSpecial = ws.id === SPECIAL_WORKSPACE_ID;
                    const specialStyles = useStyle({
                        backgroundColor: 'var(--shade-primary-container)',
                        borderRadius: 'var(--shade-radius)',
                    });

                    return (
                        <Gtk.Box
                            ref={isSpecial ? specialStyles.$ : undefined}
                            orientation={vertical.as((v) =>
                                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                            )}
                            cssClasses={[
                                'flat',
                                'card',
                                ...(isSpecial ? [specialStyles.class] : []),
                            ]}
                            spacing={4}
                        >
                            <For each={bind(ws, 'clients')}>
                                {(client: Hyprland.Client) => (
                                    <Gtk.ToggleButton
                                        active={computed(() => activeName() === client.address)}
                                        onClicked={() => client.focus()}
                                        cssClasses={['flat']}
                                    >
                                        <Gtk.Image iconName={getAppIcon(client)} pixelSize={24} />
                                    </Gtk.ToggleButton>
                                )}
                            </For>
                            {/* show empty dot when ws is empty */}
                            <With value={bind(ws, 'clients').as((clients) => clients.length < 1)}>
                                {(isEmpty: boolean) =>
                                    isEmpty ? (
                                        <Gtk.ToggleButton
                                            active={false}
                                            cssClasses={['flat']}
                                        ></Gtk.ToggleButton>
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
