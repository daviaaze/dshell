import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
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
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={18}
            ref={(self) => {
                const mapSignal = self.connect('map', () => {
                    if (self.get_root() instanceof Gtk.Window) refresh();
                });
                onCleanup(() => self.disconnect(mapSignal));
            }}
        >
            <Adw.PreferencesGroup
                title="Atalhos de teclado"
                description="Consultar ações e comandos ativos do Hyprland."
            >
                <Adw.ActionRow
                    title="Atualizar atalhos"
                    subtitle="Ler os atalhos atuais do Hyprland."
                >
                    <Gtk.Button
                        slot="suffix"
                        valign={Gtk.Align.CENTER}
                        iconName="view-refresh-symbolic"
                        tooltipText="Atualizar atalhos ativos"
                        onClicked={refresh}
                    />
                </Adw.ActionRow>
                <Adw.ActionRow title="Configuração do Hyprland" subtitle={keybinds.configPath}>
                    <Gtk.Button
                        slot="suffix"
                        valign={Gtk.Align.CENTER}
                        label="Abrir"
                        onClicked={() => keybinds.openConfig()}
                    />
                </Adw.ActionRow>
                <Adw.ActionRow
                    visible={categories.as((groups) => groups.length === 0)}
                    title={loaded.as((isLoaded) =>
                        isLoaded ? 'Nenhum atalho ativo disponível' : 'Carregando atalhos ativos…'
                    )}
                    subtitle={loaded.as((isLoaded) =>
                        isLoaded
                            ? 'Hyprland pode estar indisponível ou sem atalhos configurados. Confira o compositor e atualize.'
                            : 'Consultando os atalhos atuais do Hyprland.'
                    )}
                />
            </Adw.PreferencesGroup>
            <For each={categories}>
                {(group) => (
                    <Adw.PreferencesGroup title={group.category}>
                        <For each={computed(() => group.binds)}>
                            {(bind: HyprBind) => {
                                const title = GLib.markup_escape_text(
                                    keybinds.formatTitle(bind),
                                    -1
                                );
                                return (
                                    <Adw.ExpanderRow
                                        title={title}
                                        subtitle={
                                            keybinds.formatKeyCombo(bind) ||
                                            'Nenhuma tecla informada'
                                        }
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
                                                label="Copiar comando"
                                                halign={Gtk.Align.START}
                                                onClicked={(self) =>
                                                    self
                                                        .get_display()
                                                        ?.get_clipboard()
                                                        .set(bind.arg)
                                                }
                                                ref={(self) =>
                                                    self.update_property(
                                                        [Gtk.AccessibleProperty.LABEL],
                                                        [
                                                            new GObject.Value(
                                                                GObject.TYPE_STRING,
                                                                'Copiar comando'
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
        </Gtk.Box>
    );
};
