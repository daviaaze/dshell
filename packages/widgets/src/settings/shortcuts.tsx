import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Keybinds, {type HyprBind} from '@shade/services/input/keybinds';
import {computed, createState, For, onCleanup} from 'gnim';

const DISPATCHER_DESCRIPTIONS: Record<string, string> = {
    workspace: 'Switch workspace',
    movetoworkspace: 'Move window to workspace',
    movetoworkspacesilent: 'Move window to workspace without switching',
    togglefloating: 'Toggle floating mode',
    fullscreen: 'Toggle fullscreen',
    focuswindow: 'Focus window',
    movewindow: 'Move window',
    resizewindow: 'Resize window',
    killactive: 'Close active window',
    togglepseudo: 'Toggle pseudo-tile mode',
    pin: 'Pin window',
    cyclenext: 'Cycle window focus',
    changegroupactive: 'Change active window in group',
    splitratio: 'Adjust split ratio',
    togglesplit: 'Toggle split direction',
    layoutopt: 'Change layout option',
    swapnext: 'Swap with next window',
    swapactiveworkspaces: 'Swap active workspaces',
    exit: 'Exit Hyprland',
    forcerendererreload: 'Reload the renderer',
};

const SHADE_COMMANDS: Array<[RegExp, string]> = [
    [/\bshade-shell\s+toggle\s+launcher(?:\s|$)/, 'Toggle app launcher'],
    [/\bshade-shell\s+toggle\s+quicksettings(?:\s|$)/, 'Toggle quick settings'],
    [/\bshade-shell\s+toggle\s+bar(?:\s|$)/, 'Toggle top bar'],
    [/\bshade-shell\s+toggle\s+windowswitcher(?:\s|$)/, 'Toggle window switcher'],
    [/\bshade-shell\s+toggle\s+settings(?:\s|$)/, 'Toggle settings'],
    [
        /\bshade-shell\s+toggle\s+touchpad(?:\s|$)|\bshade-shell\s+touchpad(?:\s|$)/,
        'Toggle touchpad',
    ],
    [/\bshade-shell\s+clipboard(?:\s|$)/, 'Open launcher in clipboard mode'],
    [/\bshade-shell\s+open-clipboard(?:\s|$)/, 'Open clipboard history directly'],
    [/\bshade-shell\s+lockscreen(?:\s|$)/, 'Lock the screen'],
    [/\bshade-shell\s+screenshot-area(?:\s|$)/, 'Take a screenshot of a selected area'],
    [/\bshade-shell\s+screenshot-overlay(?:\s|$)/, 'Open the capture overlay'],
    [/\bshade-shell\s+screenshot(?:\s|$)/, 'Take a fullscreen screenshot'],
    [/\bshade-shell\s+record-area(?:\s|$)/, 'Record a selected area'],
    [/\bshade-shell\s+record-window(?:\s|$)/, 'Record the focused window'],
    [/\bshade-shell\s+record-output(?:\s|$)/, 'Record the focused output'],
    [/\bshade-shell\s+record(?:\s|$)/, 'Start fullscreen recording'],
    [/\bshade-shell\s+display-next(?:\s|$)/, 'Cycle saved display layouts'],
    [/\bshade-shell\s+display-mode-chooser(?:\s|$)/, 'Choose display mode'],
    [/\bshade-shell\s+display-toggle-internal(?:\s|$)/, 'Toggle internal display'],
    [/\bshade-shell\s+display-mode\s+internal-only(?:\s|$)/, 'Use internal-only display mode'],
    [/\bshade-shell\s+display-mode\s+external-only(?:\s|$)/, 'Use external-only display mode'],
    [/\bshade-shell\s+display-mode\s+extend(?:\s|$)/, 'Extend displays'],
    [/\bshade-shell\s+display-mode\s+duplicate(?:\s|$)/, 'Duplicate displays'],
];

const describeBind = (bind: HyprBind, keybinds: Keybinds): string => {
    if (bind.dispatcher === 'exec') {
        const action = SHADE_COMMANDS.find(([pattern]) => pattern.test(bind.arg));
        if (action) return action[1];
    }

    const description = DISPATCHER_DESCRIPTIONS[bind.dispatcher];
    return description
        ? bind.arg
            ? `${description}: ${bind.arg}`
            : description
        : keybinds.formatDescription(bind);
};

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
                    // Mapping occurs when the settings page is entered, including
                    // when its existing window is shown again after being hidden.
                    const mapSignal = self.connect('map', refresh);
                    onCleanup(() => self.disconnect(mapSignal));
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
                            {(bind: HyprBind) => (
                                <Adw.ActionRow
                                    title={describeBind(bind, keybinds)}
                                    subtitle={keybinds.formatKeyCombo(bind) || 'No key specified'}
                                />
                            )}
                        </For>
                    </Adw.PreferencesGroup>
                )}
            </For>
        </>
    );
};
