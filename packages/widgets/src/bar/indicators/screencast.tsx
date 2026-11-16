import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import Screencast from '@shade/services/capture/screencast';
import {type Accessor, bind, For} from 'gnim';

const SOURCE_LABELS: Record<string, string> = {
    monitor: 'Monitor',
    window: 'Janela',
    region: 'Área',
    workspace: 'Espaço de trabalho',
};

export default ({vertical}: {vertical: Accessor<boolean>}) => {
    const service = Screencast.get_default();
    const sources = bind(service, 'sources');
    const count = sources.as((items) => items.length);
    const tooltip = count.as((total) =>
        total === 1 ? 'Uma captura de tela ativa' : `${total} capturas de tela ativas`
    );
    return (
        <Gtk.MenuButton
            visible={bind(service, 'active')}
            cssClasses={vertical.as((value) =>
                value ? ['flat', 'bar-vertical-content-button'] : ['flat']
            )}
            tooltipText={tooltip}
        >
            <Gtk.Box
                spacing={4}
                orientation={vertical.as((value) =>
                    value ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Image iconName="video-display-symbolic" />
                <Gtk.Label
                    label={count.as((total) =>
                        total > 1 ? `Compartilhando (${total})` : 'Compartilhando'
                    )}
                    maxWidthChars={vertical.as((value) => (value ? 5 : 20))}
                    ellipsize={Pango.EllipsizeMode.END}
                />
            </Gtk.Box>
            <Gtk.Popover slot="popover">
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={8}
                    marginTop={12}
                    marginBottom={12}
                    marginStart={12}
                    marginEnd={12}
                >
                    <Gtk.Label
                        label="Compartilhamento de tela"
                        xalign={0}
                        cssClasses={['heading']}
                    />
                    <For each={sources}>
                        {(source) => (
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                                <Gtk.Label
                                    label={
                                        source.appName ||
                                        source.appId ||
                                        'Aplicativo não identificado'
                                    }
                                    xalign={0}
                                    wrap
                                    cssClasses={['heading']}
                                />
                                <Gtk.Label
                                    label={`${SOURCE_LABELS[source.kind ?? ''] ?? 'Tela'}: ${source.description}`}
                                    xalign={0}
                                    wrap
                                />
                            </Gtk.Box>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.Popover>
        </Gtk.MenuButton>
    );
};
