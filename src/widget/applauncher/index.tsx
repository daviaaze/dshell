import Hyprland from 'gi://AstalHyprland';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {createBinding, createState, For} from 'gnim';
import AppButton from './appButton';
import ClipboardButton from './clipboardButton';
import {searchClipboard} from '#/lib/services/clipboard';
import {getAppList, fuzzyQuery} from '#/lib/services/state/apps';
import {FrecencyManager} from '#/lib/services/search/frecency';
import {useSettings} from '#/lib/settings';
import {app} from '#/apps/shell/App';
import WindowManager from '#/lib/services/state/windowManager';
import ShellState from '#/lib/services/state/shellState';
import logger from '#/lib/core/logger';
import Apps from 'gi://AstalApps';
import type {ClipboardItem} from '#/lib/services/clipboard';

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

type LauncherMode = 'apps' | 'clipboard';
type ListItem = Apps.Application | ClipboardItem;

export default () => {
    const barCfg = useSettings().bar;
    const hyprland = Hyprland.get_default();
    const fm = FrecencyManager.get_default();
    const [list, setList] = createState<ListItem[]>(
        fm.rankByFrecency(getAppList(), app => app.entry ?? app.name ?? '')
    );
    const [mode, setMode] = createState<LauncherMode>('apps');
    let entryRef: Gtk.Entry | null = null;

    const updateSearch = (text: string) => {
        if (text.startsWith('>')) {
            setMode('clipboard');
            const query = text.slice(1).trim();
            searchClipboard(query, results => setList(results));
        } else if (text.trim() === '') {
            setMode('apps');
            setList(fm.rankByFrecency(getAppList(), app => app.entry ?? app.name ?? ''));
        } else {
            setMode('apps');
            const fuzzyResults = fuzzyQuery(text);
            // Re-rank by frecency boost
            const scored = fuzzyResults.map(app => ({
                app,
                score: fm.getSearchBoost(app.entry ?? app.name ?? ''),
            }));
            scored.sort((a, b) => b.score - a.score);
            setList(scored.map(s => s.app));
        }
    };

    return (
        <Astal.Window
            $={self => {
                WindowManager.get_default().setApplauncher(self);
                self.connect('realize', () =>
                    logger.log('applauncher realized')
                );
                self.connect('map', () => logger.log('applauncher mapped'));
            }}
            valign={Gtk.Align.CENTER}
            name={'applauncher'}
            margin={12}
            application={app}
            visible={createBinding(ShellState.get_default(), 'launcherOpen')}
            onNotifyVisible={self => {
                logger.log(`applauncher visible -> ${self.visible}`);
                if (
                    (barCfg.position() === LEFT ||
                        barCfg.position() === RIGHT) &&
                    self.visible &&
                    ShellState.get_default().qsOpen
                )
                    ShellState.get_default().qsOpen = false;
                if (self.visible) {
                    const query = ShellState.get_default().launcherQuery;
                    if (query && entryRef) {
                        entryRef.set_text(query);
                    }
                    entryRef?.grab_focus();
                    updateSearch(query);
                } else {
                    entryRef?.set_text('');
                    setMode('apps');
                    ShellState.get_default().launcherQuery = '';
                }
                ShellState.get_default().launcherOpen = self.visible;
            }}
            cssClasses={['card', 'frame', 'background']}
            css={'padding-right:0px;'}
            keymode={Astal.Keymode.ON_DEMAND}
            monitor={createBinding(hyprland, 'focusedMonitor').as(m => m.id)}
            anchor={barCfg.position.as(
                p => TOP | (p === RIGHT ? RIGHT : LEFT) | BOTTOM
            )}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['applauncher-body']}
                spacing={8}
            >
                <Gtk.Entry
                    hexpand
                    css={'margin-right:4px;'}
                    placeholderText={mode.as(m =>
                        m === 'clipboard'
                            ? 'Search clipboard history...'
                            : 'Search your apps'
                    )}
                    $={self => {
                        entryRef = self;
                    }}
                    onNotifyText={self => updateSearch(self.text)}
                    onActivate={self => {
                        WindowManager.get_default().applauncher!.visible = false;
                        if (mode() === 'apps') {
                            const results = fuzzyQuery(self.text);
                            if (results.length > 0) results?.[0]?.launch();
                        }
                    }}
                >
                    <Gtk.EventControllerKey
                        $={self => {
                            self.connect('key-pressed', (_, keyval) => {
                                if (keyval === Gdk.KEY_Escape) {
                                    WindowManager.get_default().applauncher!.visible = false;
                                    return true;
                                }
                                return false;
                            });
                        }}
                    />
                </Gtk.Entry>
                <Gtk.Label
                    visible={mode.as(m => m === 'clipboard')}
                    halign={Gtk.Align.START}
                    marginStart={4}
                    cssClasses={['caption']}
                    label="Clipboard History — type &gt; to search"
                />
                <Gtk.Label
                    visible={mode.as(m => m === 'apps')}
                    halign={Gtk.Align.START}
                    marginStart={4}
                    cssClasses={['caption']}
                    label={list.as(l =>
                        fm.hasData && l.length > 0
                            ? entryRef?.text
                                ? 'Search results (boosted by usage)'
                                : 'Most used apps'
                            : ''
                    )}
                />
                <Gtk.ScrolledWindow
                    css={'padding-right:0px;'}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER}
                    propagateNaturalHeight
                >
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        css={'padding-right: 12px;'}
                        spacing={8}
                    >
                        <For each={list}>
                            {(item: ListItem) =>
                                mode() === 'clipboard' ? (
                                    <ClipboardButton
                                        item={item as ClipboardItem}
                                    />
                                ) : (
                                    <AppButton
                                        application={item as Apps.Application}
                                    />
                                )
                            }
                        </For>
                        <Adw.StatusPage
                            visible={list.as(l => l.length === 0)}
                            iconName={mode.as(m =>
                                m === 'clipboard'
                                    ? 'edit-paste-symbolic'
                                    : 'system-search-symbolic'
                            )}
                            title={mode.as(m =>
                                m === 'clipboard'
                                    ? 'Nenhum resultado no histórico'
                                    : 'Nenhum aplicativo encontrado'
                            )}
                            description={mode.as(m =>
                                m === 'clipboard'
                                    ? 'Copie algo para aparecer aqui'
                                    : 'Tente um termo de busca diferente'
                            )}
                        />
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </Astal.Window>
    );
};
