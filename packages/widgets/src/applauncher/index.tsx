import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import type AstalApps from 'gi://AstalApps?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import {bus} from '@shade/services/bus';
import type {ClipboardEntry} from '@shade/services/clipboard/encryptedStore';
import {getHyprland} from '@shade/services/hyprland';
import type {LauncherMode, ListItem} from '@shade/services/search/launcher';
import {launcherSearch} from '@shade/services/search/launcher';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {fuzzyQuery} from '@shade/services/state/apps';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {type Accessor, bind, computed, createState, For, onCleanup} from 'gnim';
import {BAR_EDGE_RESERVE} from '../bar/geometry';
import {OPAQUE_SURFACE_CSS, SURFACE_PADDING} from '../common/surface';
import AppButton, {launchFromLauncher} from './appButton';
import ClipboardButton from './clipboardButton';

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;
const LAUNCHER_WIDTH = 640;
const WINDOW_MARGIN = 4;

function availableLauncherWidth(
    monitor: {width: number; scale: number} | null,
    barPosition: number,
    left: number,
    right: number
) {
    const logicalWidth = monitor
        ? monitor.width / (monitor.scale || 1)
        : LAUNCHER_WIDTH + WINDOW_MARGIN * 2;
    const barReserve = barPosition === left || barPosition === right ? BAR_EDGE_RESERVE : 0;
    return Math.max(1, Math.min(LAUNCHER_WIDTH, logicalWidth - WINDOW_MARGIN * 2 - barReserve));
}

/** Shared handle so the window and hint labels can read the entry. */
interface EntryHolder {
    current: Gtk.Entry | null;
}

/** Search entry: updates results on type, launches top hit on activate. */
function SearchEntry({
    mode,
    list,
    holder,
    updateSearch,
}: {
    mode: Accessor<LauncherMode>;
    list: Accessor<ListItem[]>;
    holder: EntryHolder;
    updateSearch: (text: string) => void;
}) {
    return (
        <Gtk.Entry
            hexpand
            placeholderText={mode.as((m) =>
                m === 'clipboard'
                    ? 'Pesquisar no histórico da área de transferência...'
                    : 'Pesquisar aplicativos · digite > para a área de transferência'
            )}
            ref={(self) => {
                holder.current = self;
            }}
            onNotifyText={(self) => updateSearch(self.text)}
            onActivate={(self) => {
                // Launch the highlighted row: the first ranked result of a non-empty search.
                const first = mode() === 'apps' && self.text.trim() !== '' ? list()[0] : undefined;
                if (first) {
                    launchFromLauncher(first as AstalApps.Application);
                } else {
                    WindowManager.get_default().applauncher!.visible = false;
                }
            }}
        />
    );
}

/** Context caption above the results — clipboard hint or frecency note. */
function HintLabel({
    mode,
    list,
    frecencyHasData,
    holder,
}: {
    mode: Accessor<LauncherMode>;
    list: Accessor<ListItem[]>;
    frecencyHasData: Accessor<boolean>;
    holder: EntryHolder;
}) {
    return (
        <>
            <Gtk.Label
                visible={mode.as((m) => m === 'clipboard')}
                halign={Gtk.Align.START}
                marginStart={4}
                cssClasses={['caption']}
                label="Histórico da área de transferência — digite &gt; para pesquisar"
            />
            <Gtk.Label
                visible={mode.as((m) => m === 'apps')}
                halign={Gtk.Align.START}
                marginStart={4}
                cssClasses={['caption']}
                label={list.as((l) => {
                    if (!frecencyHasData() || l.length === 0) return '';
                    return holder.current?.text
                        ? 'Resultados da pesquisa (priorizados por uso)'
                        : 'Apps mais usados';
                })}
            />
        </>
    );
}

/** Scrollable results — app/clipboard buttons plus the empty state. */
function ResultsList({
    mode,
    list,
    query,
    maxContentWidth,
}: {
    mode: Accessor<LauncherMode>;
    list: Accessor<ListItem[]>;
    query: Accessor<string>;
    maxContentWidth: Accessor<number>;
}) {
    return (
        <Gtk.ScrolledWindow
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            propagateNaturalHeight
            maxContentWidth={maxContentWidth}
            propagateNaturalWidth={false}
        >
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <For each={list}>
                    {(item: ListItem, index) =>
                        mode() === 'clipboard' ? (
                            <ClipboardButton item={item as ClipboardEntry} />
                        ) : (
                            <AppButton
                                application={item as AstalApps.Application}
                                highlighted={computed(() => index() === 0 && query().trim() !== '')}
                            />
                        )
                    }
                </For>
                <Adw.StatusPage
                    visible={list.as((l) => l.length === 0)}
                    iconName={mode.as((m) =>
                        m === 'clipboard' ? 'edit-paste-symbolic' : 'system-search-symbolic'
                    )}
                    title={mode.as((m) =>
                        m === 'clipboard'
                            ? 'Nenhum resultado no histórico da área de transferência'
                            : 'Nenhum aplicativo encontrado'
                    )}
                    description={mode.as((m) =>
                        m === 'clipboard'
                            ? 'Copie algo para vê-lo aqui'
                            : 'Tente outro termo de pesquisa'
                    )}
                />
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
}

export default () => {
    const barCfg = barSettings();
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const focusedMonitor = bind(hyprland, 'focused-monitor');
    const launcherWidth = computed(() =>
        availableLauncherWidth(focusedMonitor(), barCfg.position(), LEFT, RIGHT)
    );
    const shellState = ShellState.get_default();
    const [list, setList] = createState<ListItem[]>([]);
    const [query, setQuery] = createState('');
    const [mode, setMode] = createState<LauncherMode>('apps');
    const [frecencyHasData, setFrecencyHasData] = createState(false);
    const holder: EntryHolder = {current: null};

    const updateSearch = (text: string) => {
        const result = launcherSearch(text);
        setQuery(text);
        setMode(result.mode);
        setList(result.items);
        setFrecencyHasData(result.frecencyHasData);
    };

    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().setApplauncher(self);
                self.connect('realize', () => logger.log('applauncher realized'));
                self.connect('map', () => logger.log('applauncher mapped'));
                // Esc closes the launcher even after focus moved off the entry onto a result.
                const keys = new Gtk.EventControllerKey({
                    propagationPhase: Gtk.PropagationPhase.CAPTURE,
                });
                keys.connect('key-pressed', (_controller, keyval) => {
                    if (keyval !== Gdk.KEY_Escape) return false;
                    self.visible = false;
                    return true;
                });
                self.add_controller(keys);
                onCleanup(() => self.remove_controller(keys));
            }}
            valign={Gtk.Align.CENTER}
            name={'applauncher'}
            widthRequest={launcherWidth}
            marginTop={WINDOW_MARGIN}
            marginBottom={WINDOW_MARGIN}
            marginStart={WINDOW_MARGIN}
            marginEnd={WINDOW_MARGIN}
            application={getApp()}
            namespace={'shade-launcher'}
            visible={bind(shellState, 'launcherOpen')}
            onNotifyVisible={(self) => {
                logger.log(`applauncher visible -> ${self.visible}`);
                if (
                    (barCfg.position() === LEFT || barCfg.position() === RIGHT) &&
                    self.visible &&
                    ShellState.get_default().qsOpen
                )
                    bus.emit('shell:qs:close');
                if (self.visible) {
                    const query = ShellState.get_default().launcherQuery;
                    if (query && holder.current) {
                        holder.current.set_text(query);
                    }
                    holder.current?.grab_focus();
                    updateSearch(query);
                } else {
                    holder.current?.set_text('');
                    setMode('apps');
                    bus.emit('shell:launcher:close');
                }
            }}
            cssClasses={['background']}
            css={`${OPAQUE_SURFACE_CSS} border-radius: var(--window-radius);`}
            keymode={Astal.Keymode.ON_DEMAND}
            monitor={focusedMonitor.as((m) => monitorIndexFromHyprland(m))}
            anchor={barCfg.position.as((p) => TOP | (p === RIGHT ? RIGHT : LEFT) | BOTTOM)}
        >
            <Gtk.Box
                marginTop={SURFACE_PADDING}
                marginBottom={SURFACE_PADDING}
                marginStart={SURFACE_PADDING}
                marginEnd={SURFACE_PADDING}
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
            >
                <SearchEntry mode={mode} list={list} holder={holder} updateSearch={updateSearch} />
                <HintLabel
                    mode={mode}
                    list={list}
                    frecencyHasData={frecencyHasData}
                    holder={holder}
                />
                <ResultsList
                    mode={mode}
                    list={list}
                    query={query}
                    maxContentWidth={launcherWidth}
                />
            </Gtk.Box>
        </Astal.Window>
    );
};
