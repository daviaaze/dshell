import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

interface AutostartEntry {
    name: string;
    enabled: boolean;
    filePath: string;
}

export default () => {
    const autostartDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart']);

    const readAutostartEntries = (): AutostartEntry[] => {
        const entries: AutostartEntry[] = [];
        try {
            const dir = Gio.File.new_for_path(autostartDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
                return entries;
            }

            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo = enumerator.next_file(null);
            while (fileInfo) {
                const name = fileInfo.get_name();
                if (name.endsWith('.desktop')) {
                    const filePath = GLib.build_filenamev([autostartDir, name]);
                    const file = Gio.File.new_for_path(filePath);
                    const [success, contents] = file.load_contents(null);
                    if (success) {
                        const content = new TextDecoder().decode(contents);
                        const enabled = !content.includes('Hidden=true');
                        entries.push({name: name.replace('.desktop', ''), enabled, filePath});
                    }
                }
                fileInfo = enumerator.next_file(null);
            }
        } catch {}
        return entries;
    };

    const toggleAutostart = (entry: AutostartEntry, enabled: boolean) => {
        try {
            const file = Gio.File.new_for_path(entry.filePath);
            const [success, contents] = file.load_contents(null);
            if (!success) return;

            let content = new TextDecoder().decode(contents);
            if (enabled) {
                content = content.replace(/^Hidden=true\s*$/m, '');
            } else {
                if (!content.includes('Hidden=')) {
                    content += '\nHidden=true\n';
                } else {
                    content = content.replace(/^Hidden=false\s*$/m, 'Hidden=true');
                }
            }

            file.replace_contents(
                new TextEncoder().encode(content),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch {}
    };

    const entries = readAutostartEntries();
    
    return (
        <Adw.PreferencesGroup
            title="Startup Applications"
            description="Apps that launch automatically at login"
        >
            {entries.map((entry) => (
                <Adw.SwitchRow
                    title={entry.name}
                    subtitle={entry.filePath}
                    active={entry.enabled}
                    onNotifyActive={(self) => {
                        toggleAutostart(entry, self.active);
                    }}
                />
            ))}
        </Adw.PreferencesGroup>
    );
};
