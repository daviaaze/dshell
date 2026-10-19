import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Keybinds, {type HyprBind} from '@shade/services/input/keybinds';
import {computed, createState, For, onCleanup} from 'gnim';


export default () => {
    const keybinds = Keybinds.get_default();
    const [categories, setCategories] = createState(keybinds.getCategorizedBinds());
    const [loaded, setLoaded] = createState(false);

    const updateBinds = () => {
        setCategories(keybinds.getCategorizedBinds());
        setLoaded(true);
    };
    const refresh = () => {
        setLoaded(false);
        keybinds.refresh();
    };
    const bindsSignal = keybinds.connect('notify', (_source, pspec) => {
        if (pspec.name === 'binds') updateBinds();
    });

    onCleanup(() => keybinds.disconnect(bindsSignal));

    return (
        <>
            <Adw.PreferencesGroup
                ref={(self) => {
                    let window: Adw.PreferencesWindow | null = null;
                    let page: Adw.PreferencesPage | null = null;
                    let pageSignal = 0;
                    let visibilitySignal = 0;
                    let active = false;
                    const updateActive = () => {
                        const next = window !== null && window.visible && window.get_visible_page() === page;
                        const entered = next && !active;
                        active = next;
                        if (entered) refresh();
                    };
                    const mapSignal = self.connect('map', () => {
                        if (!window) {
                            const root = self.get_root();
                            const owner = self.get_ancestor(Adw.PreferencesPage.$gtype);
                            if (!(root instanceof Adw.PreferencesWindow) ||
                                !(owner instanceof Adw.PreferencesPage)) return;
                            window = root;
                            page = owner;
                            pageSignal = root.connect('notify::visible-page', updateActive);
                            visibilitySignal = root.connect('notify::visible', updateActive);
                        }
                        // Group remapping during search/model rebuilding is not
                        // navigation. Only entry into the selected visible page refreshes.
                        updateActive();
                    });
                    onCleanup(() => {
                        self.disconnect(mapSignal);
                        if (window) {
                            window.disconnect(pageSignal);
                            window.disconnect(visibilitySignal);
                        }
                    });
                }}
                title="Keyboard Shortcuts"
                description="View active keybindings"
            >
                <Adw.ActionRow
                    title="Refresh keybindings"
                    subtitle="Read the current bindings from Hyprland"
                >
                    <Gtk.Button
                        slot="suffix"
                        valign={Gtk.Align.CENTER}
                        iconName="view-refresh-symbolic"
                        tooltipText="Refresh active keybindings"
                        onClicked={refresh}
                    />
                </Adw.ActionRow>
                <Adw.ActionRow title="Hyprland configuration" subtitle={keybinds.configPath}>
                    <Gtk.Button
                        slot="suffix"
                        valign={Gtk.Align.CENTER}
                        label="Open"
                        onClicked={() => keybinds.openConfig()}
                    />
                </Adw.ActionRow>
                <Adw.ActionRow
                    visible={categories.as((groups) => groups.length === 0)}
                    title={loaded.as((isLoaded) =>
                        isLoaded ? 'No active keybindings available' : 'Loading active keybindings…'
                    )}
                    subtitle={loaded.as((isLoaded) =>
                        isLoaded
                            ? 'No bindings are available. Hyprland may be unavailable or have no configured binds; check the compositor and configuration, then refresh.'
                            : 'Fetching the current bindings from Hyprland.'
                    )}
                />
            </Adw.PreferencesGroup>
            <For each={categories}>
                {(group) => (
                    <Adw.PreferencesGroup title={group.category}>
                        <For each={computed(() => group.binds)}>
                            {(bind: HyprBind) => {
                                const title = GLib.markup_escape_text(
                                    keybinds.formatDescription(bind),
                                    -1
                                );
                                return (
                                    <Adw.ExpanderRow
                                        title={title}
                                        subtitle={keybinds.formatKeyCombo(bind) || 'No key specified'}
                                    >
                                        <Gtk.Box
                                            orientation={Gtk.Orientation.VERTICAL}
                                            spacing={8}
                                            marginTop={8}
                                            marginBottom={8}
                                            marginStart={12}
                                            marginEnd={12}
                                        >
                                            <Gtk.Label
                                                label={bind.arg}
                                                xalign={0}
                                                selectable
                                                wrap
                                                cssClasses={['monospace']}
                                            />
                                            <Gtk.Button
                                                label="Copy command"
                                                halign={Gtk.Align.START}
                                                onClicked={(self) =>
                                                    self.get_display()?.get_clipboard().set(bind.arg)
                                                }
                                                ref={(self) =>
                                                    self.update_property(
                                                        [Gtk.AccessibleProperty.LABEL],
                                                        [
                                                            new GObject.Value(
                                                                GObject.TYPE_STRING,
                                                                'Copy command'
                                                            ),
                                                        ]
                                                    )
                                                }
                                            />
                                        </Gtk.Box>
                                    </Adw.ExpanderRow>
                                );
                            }}
                        </For>
                    </Adw.PreferencesGroup>
                )}
            </For>
        </>
    );
};
