import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {createState, For} from 'gnim';
import AppButton from './appButton';
import ClipboardButton from './clipboardButton';
import {searchClipboard} from '#/lib/services/clipboard';
import {getAppList, fuzzyQuery} from '#/lib/services/state/apps';
import {FrecencyManager} from '#/lib/services/search/frecency';
import WindowManager from '#/lib/services/state/windowManager';
import ShellState from '#/lib/services/state/shellState';
import PopupWindow from '#/widget/common/PopupWindow';
import {useStyle} from '#/style/useStyle';
import logger from '#/lib/core/logger';
import Apps from 'gi://AstalApps';
import type {ClipboardItem} from '#/lib/services/clipboard';

type LauncherMode = 'apps' | 'clipboard';
type ListItem = Apps.Application | ClipboardItem;

export default () => {
    const applauncherStyle = useStyle({
        'min-width': '320px',
        padding: '0 4px',
    });
    const [list, setList] = createState<ListItem[]>(
        getTopFrecencyApps(FrecencyManager.get_default())
    );
    const [mode, setMode] = createState<LauncherMode>('apps');
    let entryRef: Gtk.Entry | null = null;

    const updateSearch = (text: string) => {
        const fm = FrecencyManager.get_default();
        if (text.startsWith('>')) {
            setMode('clipboard');
            const query = text.slice(1).trim();
            searchClipboard(query, results => setList(results));
        } else if (text.trim() === '') {
            setMode('apps');
            setList(getTopFrecencyApps(fm));
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

    const close = () => {
        ShellState.get_default().launcherOpen = false;
    };

    return (
        <PopupWindow
            name="applauncher"
            visible={ShellState.get_default().launcherOpen}
            onClose={close}
            onVisibleChange={visible => {
                logger.log(`applauncher visible -> ${visible}`);
                if (visible) {
                    const query = ShellState.get_default().launcherQuery;
                    if (query && entryRef) entryRef.set_text(query);
                    entryRef?.grab_focus();
                    updateSearch(query);
                } else {
                    entryRef?.set_text('');
                    setMode('apps');
                    ShellState.get_default().launcherQuery = '';
                }
                ShellState.get_default().launcherOpen = visible;
            }}
            $={self => {
                WindowManager.get_default().setApplauncher(self);
                self.connect('realize', () => logger.log('applauncher realized'));
                self.connect('map', () => logger.log('applauncher mapped'));
            }}
            widthRequest={400}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['applauncher-body', applauncherStyle.class]}
                spacing={8}
                $={applauncherStyle.$}
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
                        const text = self.text;
                        close();
                        if (mode() === 'apps') {
                            const results = fuzzyQuery(text);
                            if (results.length > 0) {
                                onAppLaunch(results[0]!);
                            }
                        }
                    }}
                >
                    <Gtk.EventControllerKey
                        $={self => {
                            self.connect('key-pressed', (_, keyval) => {
                                if (keyval === Gdk.KEY_Escape) {
                                    close();
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
                {mode.as(m =>
                    m === 'apps' ? (
                        <Gtk.Label
                            visible={list.as(l => frecency.hasData && l.length > 0)}
                            halign={Gtk.Align.START}
                            marginStart={4}
                            cssClasses={['caption']}
                            label={
                                entryRef?.text
                                    ? 'Search results (boosted by usage)'
                                    : 'Most used apps'
                            }
                        />
                    ) : null
                )}
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
                        <Adw.StatusPage
                            visible={list.as(l => l.length === 0)}
                            vexpand
                            cssClasses={['compact']}
                            title={mode.as(m =>
                                m === 'clipboard'
                                    ? 'No Clipboard Items'
                                    : 'No Apps Found'
                            )}
                            description={mode.as(m =>
                                m === 'clipboard'
                                    ? 'Your clipboard history is empty'
                                    : 'Try a different search term'
                            )}
                            iconName={mode.as(m =>
                                m === 'clipboard'
                                    ? 'edit-paste-symbolic'
                                    : 'system-search-symbolic'
                            )}
                        />
                        <For each={list}>
                            {(item: ListItem) =>
                                mode() === 'clipboard' ? (
                                    <ClipboardButton
                                        item={item as ClipboardItem}
                                    />
                                ) : (
                                    <AppButton
                                        application={item as Apps.Application}
                                        onClicked={close}
                                    />
                                )
                            }
                        </For>
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </PopupWindow>
    );
};

// ── Helpers ──

function getTopFrecencyApps(frecency: FrecencyManager): Apps.Application[] {
    const topIds = frecency.getTopApps(30);
    const allApps = getAppList();
    const appMap = new Map<string, Apps.Application>();
    for (const app of allApps) {
        const id = app.entry ?? app.name;
        if (id) appMap.set(id, app);
    }

    // Return top frecency apps in score order, followed by all other apps
    const top: Apps.Application[] = [];
    const rest: Apps.Application[] = [];
    const seen = new Set<string>();

    for (const id of topIds) {
        const app = appMap.get(id);
        if (app) {
            top.push(app);
            seen.add(app.entry ?? app.name ?? '');
        }
    }

    for (const app of allApps) {
        const id = app.entry ?? app.name ?? '';
        if (!seen.has(id)) {
            rest.push(app);
        }
    }

    return [...top, ...rest].slice(0, 50);
}