import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import CompositorSettings from '@shade/services/compositor/store';
import {getAppList} from '@shade/services/state/apps';
import type Apps from 'gi://AstalApps';
import type {BindSpec} from '@shade/compositor-model';
import {type Accessor, computed, createState, For, onCleanup} from 'gnim';
import {errorMessage} from './errorMessage';

function shortcutFromKey(keyval: number, modifiers: number): string | null {
    const key = Gdk.keyval_name(keyval);
    if (!key || /^(Shift|Control|Alt|Meta|Super|Hyper|Caps_Lock|Num_Lock)/.test(key)) return null;
    const parts: string[] = [];
    if (modifiers & Gdk.ModifierType.SUPER_MASK) parts.push('SUPER');
    if (modifiers & Gdk.ModifierType.SHIFT_MASK) parts.push('SHIFT');
    if (modifiers & Gdk.ModifierType.CONTROL_MASK) parts.push('CTRL');
    if (modifiers & Gdk.ModifierType.ALT_MASK) parts.push('ALT');
    parts.push(key.toUpperCase());
    return parts.join('+');
}
type ShortcutGroup = {category: string; entries: BindSpec[]};

function groupByCategory(entries: BindSpec[]): ShortcutGroup[] {
    const categories = new Map<string, BindSpec[]>();
    for (const bind of entries) {
        const category = bind.category || 'Outros';
        categories.set(category, [...(categories.get(category) ?? []), bind]);
    }
    return [...categories].map(([category, grouped]) => ({category, entries: grouped}));
}

type AppShortcutTarget = {desktopId: string; title: string};

function appShortcutTarget(app: Apps.Application): AppShortcutTarget | null {
    const entry = app.entry?.replace(/\.desktop$/i, '').trim();
    if (!entry) return null;
    return {desktopId: entry, title: app.name || entry};
}

function appBindId(desktopId: string): string {
    return `app.${desktopId.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`;
}

type AppShortcutGroupProps = {
    applications: AppShortcutTarget[];
    recording: Accessor<AppShortcutTarget | null>;
    selected: () => number;
    onRecord: (app: AppShortcutTarget | null) => void;
    onSelect: (index: number) => void;
    onStart: () => void;
};

function AppShortcutGroup({
    applications,
    recording,
    selected,
    onRecord,
    onSelect,
    onStart,
}: AppShortcutGroupProps) {
    return (
        <Adw.PreferencesGroup
            title="Criar atalho de aplicativo"
            description="Escolha um aplicativo e pressione a nova combinação."
        >
            <Adw.ComboRow
                title="Aplicativo"
                model={new Gtk.StringList({strings: applications.map((app) => app.title)})}
                selected={selected()}
                onNotifySelected={(self: Adw.ComboRow) => onSelect(self.selected)}
            />
            <Adw.ActionRow
                title="Combinação"
                subtitle={recording.as((app) =>
                    app
                        ? `Pressione as teclas para ${app.title}…`
                        : 'Nenhuma gravação em andamento.'
                )}
            >
                <Gtk.Button
                    slot="suffix"
                    valign={Gtk.Align.CENTER}
                    label={recording.as((app) => (app ? 'Cancelar' : 'Gravar'))}
                    sensitive={applications.length > 0}
                    onClicked={() => {
                        if (recording()) onRecord(null);
                        else {
                            const app = applications[selected()];
                            if (app) {
                                onStart();
                                onRecord(app);
                            }
                        }
                    }}
                />
            </Adw.ActionRow>
        </Adw.PreferencesGroup>
    );
}

function DisabledShortcutGroup({
    binds,
    onRestore,
}: {
    binds: Accessor<BindSpec[]>;
    onRestore: (id: string) => void;
}) {
    return (
        <Adw.PreferencesGroup
            title="Atalhos desativados"
            visible={binds.as((items) => items.length > 0)}
        >
            <For each={binds}>
                {(bind: BindSpec) => (
                    <Adw.ActionRow title={bind.title} subtitle={bind.keys}>
                        <Gtk.Button
                            slot="suffix"
                            valign={Gtk.Align.CENTER}
                            label="Restaurar"
                            onClicked={() => onRestore(bind.id)}
                        />
                    </Adw.ActionRow>
                )}
            </For>
        </Adw.PreferencesGroup>
    );
}

function ActiveShortcutGroup({
    group,
    recordingId,
    defaults,
    onEdit,
    onRestore,
}: {
    group: ShortcutGroup;
    recordingId: Accessor<string | null>;
    defaults: BindSpec[];
    onEdit: (id: string) => void;
    onRestore: (id: string) => void;
}) {
    return (
        <Adw.PreferencesGroup title={group.category}>
            <For each={computed(() => group.entries)}>
                {(bind: BindSpec) => (
                    <Adw.ActionRow
                        title={bind.title}
                        subtitle={recordingId.as((id) =>
                            id === bind.id ? 'Pressione a nova combinação…' : bind.keys
                        )}
                    >
                        <Gtk.Button
                            slot="suffix"
                            valign={Gtk.Align.CENTER}
                            label={recordingId.as((id) =>
                                id === bind.id ? 'Cancelar' : 'Alterar'
                            )}
                            onClicked={() => onEdit(bind.id)}
                        />
                        <Gtk.Button
                            slot="suffix"
                            valign={Gtk.Align.CENTER}
                            label="Restaurar"
                            sensitive={defaults.some((defaultBind) => defaultBind.id === bind.id)}
                            onClicked={() => onRestore(bind.id)}
                        />
                    </Adw.ActionRow>
                )}
            </For>
        </Adw.PreferencesGroup>
    );
}
function ShortcutPreferences({
    badgeEnabled,
    error,
    onBadgeChange,
}: {
    badgeEnabled: () => boolean;
    error: Accessor<string>;
    onBadgeChange: (active: boolean) => void;
}) {
    return (
        <Adw.PreferencesGroup
            title="Atalhos do compositor"
            description="Altere uma combinação e ela será aplicada imediatamente."
        >
            <Adw.SwitchRow
                title="Exibir atalhos no lançador"
                subtitle="Mostra a combinação configurada junto ao aplicativo."
                active={badgeEnabled()}
                onNotifyActive={(self) => onBadgeChange(self.active)}
            />
            <Adw.ActionRow
                visible={error.as((message) => message.length > 0)}
                title="Não foi possível aplicar o atalho"
                subtitle={error}
            />
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const compositor = CompositorSettings.get_default();
    const settings = generalSettings();
    const [binds, setBinds] = createState(compositor.effective.binds);
    const [disabledBinds, setDisabledBinds] = createState(compositor.disabledDefaults);
    const [recordingId, setRecordingId] = createState<string | null>(null);
    const [error, setError] = createState('');
    const applications = getAppList().flatMap((app) => {
        const target = appShortcutTarget(app);
        return target ? [target] : [];
    });
    const [selectedApplication, setSelectedApplication] = createState(0);
    const [recordingApplication, setRecordingApplication] = createState<AppShortcutTarget | null>(
        null
    );
    const changed = compositor.connect('notify', (_source, pspec) => {
        if (pspec.name !== 'effective-json') return;
        setBinds(compositor.effective.binds);
        setDisabledBinds(compositor.disabledDefaults);
    });
    onCleanup(() => compositor.disconnect(changed));

    const saveNewAppKey = async (keyval: number, modifiers: number): Promise<boolean> => {
        const app = recordingApplication();
        if (!app) return false;
        const keys = shortcutFromKey(keyval, modifiers);
        if (!keys) return true;
        setRecordingApplication(null);
        setError('');
        const id = appBindId(app.desktopId);
        if (binds().some((bind) => bind.id === id)) {
            setError(`Já existe um atalho para ${app.title}.`);
            return true;
        }
        try {
            await compositor.addBind({
                id,
                keys,
                title: app.title,
                category: 'Aplicativos',
                action: {type: 'launch-app', desktopId: app.desktopId},
            });
        } catch (cause) {
            setError(errorMessage(cause));
        }
        return true;
    };
    const saveKey = async (keyval: number, modifiers: number): Promise<boolean> => {
        const id = recordingId();
        if (!id) return false;
        const keys = shortcutFromKey(keyval, modifiers);
        if (!keys) return true;
        setRecordingId(null);
        setError('');
        try {
            await compositor.setBindKeys(id, keys);
        } catch (cause) {
            setError(errorMessage(cause));
        }
        return true;
    };

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={18}
            ref={(self) => {
                const keys = new Gtk.EventControllerKey({
                    propagationPhase: Gtk.PropagationPhase.CAPTURE,
                });
                keys.connect('key-pressed', (_controller, keyval, _keycode, modifiers) => {
                    if (!recordingId() && !recordingApplication()) return false;
                    if (keyval === Gdk.KEY_Escape) {
                        setRecordingId(null);
                        setRecordingApplication(null);
                        return true;
                    }
                    if (recordingApplication()) void saveNewAppKey(keyval, modifiers);
                    else void saveKey(keyval, modifiers);
                    return true;
                });
                self.add_controller(keys);
                onCleanup(() => self.remove_controller(keys));
            }}
        >
            <ShortcutPreferences
                badgeEnabled={() => settings.launcherShortcutBadges()}
                error={error}
                onBadgeChange={(active) => settings.setLauncherShortcutBadges(active)}
            />
            <For each={binds.as(groupByCategory)}>
                {(group: ShortcutGroup) => (
                    <ActiveShortcutGroup
                        group={group}
                        recordingId={recordingId}
                        defaults={compositor.defaults}
                        onEdit={(id) => {
                            setError('');
                            setRecordingApplication(null);
                            setRecordingId(recordingId() === id ? null : id);
                        }}
                        onRestore={(id) => {
                            void compositor
                                .restoreBind(id)
                                .catch((cause) => setError(errorMessage(cause)));
                        }}
                    />
                )}
            </For>
            <AppShortcutGroup
                applications={applications}
                recording={recordingApplication}
                selected={selectedApplication}
                onRecord={(app) => setRecordingApplication(app)}
                onSelect={(index) => setSelectedApplication(index)}
                onStart={() => {
                    setError('');
                    setRecordingId(null);
                }}
            />
            <DisabledShortcutGroup
                binds={disabledBinds}
                onRestore={(id) => {
                    void compositor.restoreBind(id).catch((cause) => setError(errorMessage(cause)));
                }}
            />
        </Gtk.Box>
    );
};
