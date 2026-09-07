import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import { Process } from '@shade/core/process';
import { createState } from 'gnim';

interface ShareSource {
    type: 'screen' | 'window';
    id: string;
    name: string;
}

export default () => {
    const [sources, setSources] = createState<ShareSource[]>([]);
    const [selectedSource, setSelectedSource] = createState<ShareSource | null>(null);

    const fetchSources = async () => {
        try {
            const result = await Process.execAsync('xdg-desktop-portal --share-source-list');
            const parsed = JSON.parse(result);
            setSources(parsed.sources || []);
        } catch {
            const monitors: ShareSource[] = [];
            const display = Gdk.Display.get_default();
            if (display) {
                const monitorCount = display.get_monitors().get_n_items();
                for (let i = 0; i < monitorCount; i++) {
                    monitors.push({
                        type: 'screen',
                        id: `screen${i}`,
                        name: `Monitor ${i + 1}`,
                    });
                }
            }
            setSources(monitors);
        }
    };

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        fetchSources();
        return GLib.SOURCE_REMOVE;
    });

    const sourceNames = sources().map((s) => `${s.type === 'screen' ? '🖥️' : '🪟'} ${s.name}`);
    
    const getSelectedIndex = () => {
        const sel = selectedSource();
        if (!sel) return -1;
        return sources().findIndex((s) => s.id === sel.id);
    };

    return (
        <Adw.PreferencesGroup
            title="Screen Share"
            description="Configure screen sharing preferences"
        >
            <Adw.ComboRow
                title="Default Source"
                subtitle="Choose default screen/window to share"
                model={new Gtk.StringList({ strings: sourceNames })}
                selected={getSelectedIndex()}
                onNotifySelected={(row) => {
                    const selected = sources()[row.selected];
                    if (selected) setSelectedSource(selected);
                }}
            />

            <Adw.SwitchRow
                title="Remember Choice"
                subtitle="Use selected source by default"
                active={false}
            />
        </Adw.PreferencesGroup>
    );
};
