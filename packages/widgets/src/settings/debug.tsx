import {useSettings} from '@shade/services/settings/index';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {For} from 'gnim';

export default () => {
    const settings = useSettings().general;

    return (
        <>
            <Adw.PreferencesGroup
                title={'Debug'}
                description={'Development and troubleshooting options'}
            >
                <Adw.SwitchRow
                    title={'Enable Debug Logging'}
                    subtitle={'Show DEBUG-level messages in journald'}
                    active={settings.debugEnabled}
                    onNotifyActive={self =>
                        settings.setDebugEnabled(self.active)
                    }
                />
                <Adw.EntryRow
                    title={
                        'Add Category (mount, state, theme, dbus, exec, perf, memory)'
                    }
                    showApplyButton
                    onApply={self => {
                        const cats = self.text
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean);
                        if (cats.length === 0) return;
                        const current = settings.debugCategories();
                        for (const cat of cats) {
                            if (!current.includes(cat)) {
                                current.push(cat);
                            }
                        }
                        settings.setDebugCategories(current);
                        self.text = '';
                    }}
                />
            </Adw.PreferencesGroup>

            <Adw.PreferencesGroup
                title={'Active Categories'}
                description={'Currently enabled debug categories'}
                visible={settings.debugCategories.as(cats => cats.length > 0)}
            >
                <For each={settings.debugCategories}>
                    {(cat: string) => (
                        <Adw.ActionRow title={cat}>
                            <Gtk.Button
                                slot="suffix"
                                cssClasses={['circular', 'destructive-action']}
                                iconName="list-remove-symbolic"
                                onClicked={() => {
                                    const current = settings.debugCategories();
                                    settings.setDebugCategories(
                                        current.filter(c => c !== cat)
                                    );
                                }}
                            />
                        </Adw.ActionRow>
                    )}
                </For>
                <Gtk.Button
                    cssClasses={['circular', 'destructive-action']}
                    halign={Gtk.Align.CENTER}
                    iconName="edit-clear-all-symbolic"
                    label="Clear All"
                    onClicked={() => settings.setDebugCategories([])}
                />
            </Adw.PreferencesGroup>
        </>
    );
};
