import Gtk from 'gi://Gtk?version=4.0';
import Screencast from '@shade/services/capture/screencast';
import {type Accessor, bind} from 'gnim';

const SOURCE_LABELS: Record<string, string> = {
    monitor: 'Monitor',
    window: 'Janela',
    region: 'Área',
    workspace: 'Espaço de trabalho',
};

export default ({vertical}: {vertical: Accessor<boolean>}) => {
    const service = Screencast.get_default();
    const tooltip = bind(service, 'sources').as((sources) =>
        [
            sources.length === 1
                ? 'Compartilhamento de tela ativo'
                : `${sources.length} compartilhamentos de tela ativos`,
            ...sources.map((source) => {
                const app = source.appName || source.appId || 'Aplicativo não identificado';
                const kind = SOURCE_LABELS[source.kind ?? ''] ?? 'Tela';
                return `${app} — ${kind}: ${source.description}`;
            }),
        ].join('\n')
    );
    return (
        <Gtk.Box
            visible={bind(service, 'active')}
            tooltipText={tooltip}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            marginStart={vertical.as((value) => (value ? 0 : 8))}
            marginEnd={vertical.as((value) => (value ? 0 : 8))}
            marginTop={vertical.as((value) => (value ? 8 : 0))}
            marginBottom={vertical.as((value) => (value ? 8 : 0))}
        >
            <Gtk.Image
                iconName="video-display-symbolic"
                cssClasses={['error']}
                accessibleRole={Gtk.AccessibleRole.IMG}
            />
        </Gtk.Box>
    );
};
