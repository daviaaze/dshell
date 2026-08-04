import Astal from 'gi://Astal?version=4.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gtk from 'gi://Gtk?version=4.0';
import {toArray} from '@shade/core/gjsUtils';
import {getApp} from '@shade/services/appHandle';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {getDesktopFileForClient} from '@shade/services/state/apps';
import WindowManager from '@shade/services/state/windowManager';
import {bind, computed, For, onCleanup} from 'gnim';
import DockItem from './item';

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const bar = barSettings();
    const {BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

    const clients = bind(hyprland, 'clients').as((c) => toArray<AstalHyprland.Client>(c));

    const focusedClient = bind(hyprland, 'focused-client');

    const dockItems = computed(() => {
        const pinned = bar.dockPinnedApps();
        const running = clients();
        const focused = focusedClient();
        const items: {
            desktopFile: string;
            pinned: boolean;
            clients: AstalHyprland.Client[];
            active: boolean;
        }[] = [];

        for (const df of pinned) {
            const appClients = running.filter(
                (c: AstalHyprland.Client) => getDesktopFileForClient(c) === df
            );
            const isActive = appClients.some(
                (c: AstalHyprland.Client) => c.address === focused?.address
            );
            items.push({
                desktopFile: df,
                pinned: true,
                clients: appClients,
                active: isActive,
            });
        }

        for (const client of running) {
            const df = getDesktopFileForClient(client);
            if (!df || pinned.includes(df)) continue;
            const isActive = client.address === focused?.address;
            items.push({
                desktopFile: df,
                pinned: false,
                clients: [client],
                active: isActive,
            });
        }

        return items;
    });

    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().registerDock(self);
                onCleanup(() => {
                    WindowManager.get_default().unregisterDock(self);
                });
            }}
            visible={bar.dockEnabled}
            layer={Astal.Layer.TOP}
            anchor={BOTTOM | LEFT | RIGHT}
            application={getApp()}
            name="dock"
            exclusivity={Astal.Exclusivity.NORMAL}
            marginBottom={4}
        >
            <Gtk.Box
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.END}
                spacing={8}
                cssClasses={['linked', 'card', 'background']}
            >
                <For each={dockItems}>
                    {(item) => (
                        <DockItem
                            desktopFile={item.desktopFile}
                            clients={item.clients}
                            active={item.active}
                            pinned={item.pinned}
                        />
                    )}
                </For>
            </Gtk.Box>
        </Astal.Window>
    );
};
