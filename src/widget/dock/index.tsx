import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import {createBinding, For, createComputed, onCleanup} from 'gnim';
import WindowManager from '#/lib/services/state/windowManager';
import {useSettings} from '#/lib/settings';
import {app} from '#/App';
import DockItem from './item';
import {toArray} from '#/lib/core/gjsUtils';
import {getDesktopFileForClient} from '#/lib/services/state/apps';

export default () => {
    const hyprland = AstalHyprland.get_default();
    const {bar} = useSettings();
    const {BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

    const clients = createBinding(hyprland, 'clients').as(c =>
        toArray<AstalHyprland.Client>(c)
    );

    const focusedClient = createBinding(hyprland, 'focusedClient');

    const dockItems = createComputed(
        [bar.dockPinnedApps, clients, focusedClient],
        (pinned, running, focused) => {
            const items: {
                desktopFile: string;
                pinned: boolean;
                clients: AstalHyprland.Client[];
                active: boolean;
            }[] = [];

            for (const df of pinned) {
                const appClients = running.filter(
                    c => getDesktopFileForClient(c) === df
                );
                const isActive = appClients.some(
                    c => c.address === focused?.address
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
        }
    );

    return (
        <Astal.Window
            $={self => {
                WindowManager.get_default().registerDock(self);
                onCleanup(() => {
                    WindowManager.get_default().unregisterDock(self);
                });
            }}
            visible={bar.dockEnabled}
            layer={Astal.Layer.TOP}
            anchor={BOTTOM | LEFT | RIGHT}
            application={app}
            name="dock"
            exclusivity={Astal.Exclusivity.NORMAL}
            marginBottom={4}
        >
            <Gtk.Box
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.END}
                spacing={8}
                cssClasses={['linked', 'card', 'background']}
                css={'padding: 8px; border-radius: 24px;'}
            >
                <For each={dockItems}>
                    {item => (
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
