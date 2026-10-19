import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {type AutostartEntry, readAutostartEntries, setAutostartEnabled} from '@shade/services/settings/autostart';
import {For, createState, onCleanup} from 'gnim';

function StartupAppRow({entry}: {entry: AutostartEntry}) {
    const [error, setError] = createState<string | null>(null);
    let confirmed = entry.enabled;
    let restoring = false;

    return (
        <Adw.SwitchRow
            title={entry.name}
            subtitle={error.as((message) =>
                message === null ? entry.filePath : `${entry.filePath}\n${message}`
            )}
            useMarkup={false}
            active={entry.enabled}
            onNotifyActive={(self) => {
                if (restoring) return;
                if (self.active === confirmed) return;
                setError(null);
                const result = setAutostartEnabled(entry, self.active);
                if (result.ok) {
                    confirmed = result.enabled;
                } else {
                    if (result.enabled !== null) confirmed = result.enabled;
                    setError(result.error);
                }
                restoring = true;
                self.active = confirmed;
                restoring = false;
            }}
        />
    );
}

export default () => {
    const [snapshot, setSnapshot] = createState(readAutostartEntries());
    const retryRead = () => setSnapshot(readAutostartEntries());
    const entries = snapshot.as((result) => result.entries);
    const issues = snapshot.as((result) => result.issues);

    return (
        <Adw.PreferencesGroup
            title="Startup Applications"
            description="App-provided startup entries appear here."
            ref={(self) => {
                const retry = new Gtk.Button({label: 'Retry read'});
                const clicked = retry.connect('clicked', retryRead);
                self.set_header_suffix(retry);
                onCleanup(() => {
                    retry.disconnect(clicked);
                    self.set_header_suffix(null);
                });
            }}
        >
            <For each={entries}>
                {(entry) => <StartupAppRow entry={entry} />}
            </For>
            <For each={issues}>
                {(issue) => (
                    <Adw.ActionRow
                        title={GLib.path_get_basename(issue.filePath)}
                        subtitle={issue.message}
                        useMarkup={false}
                        cssClasses={['error']}
                    />
                )}
            </For>
            {snapshot.as(
                (result) =>
                    result.entries.length === 0 &&
                    result.issues.length === 0 &&
                    result.directoryError === null && (
                        <Adw.ActionRow
                            title="No startup entries found"
                            subtitle="Startup entries supplied by applications will appear here."
                        />
                    )
            )}
            {snapshot.as((result) =>
                result.directoryError === null ? null : (
                    <Gtk.Label
                        label={`The startup directory could not be fully read: ${result.directoryError}`}
                        cssClasses={['error', 'caption']}
                        xalign={0}
                        wrap
                        marginStart={12}
                        marginEnd={12}
                        marginBottom={12}
                    />
                )
            )}
        </Adw.PreferencesGroup>
    );
};
