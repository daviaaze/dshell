import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {createState, For} from 'gnim';
import AppButton from './appButton';
import ClipboardButton from './clipboardButton';
import {searchClipboard} from '#/lib/services/clipboard';
import {getAppList, fuzzyQuery} from '#/lib/services/state/apps';
import WindowManager from '#/lib/services/state/windowManager';
import ShellState from '#/lib/services/state/shellState';
import PopupWindow from '#/widget/common/PopupWindow';
import logger from '#/lib/core/logger';
import Apps from 'gi://AstalApps';
import type {ClipboardItem} from '#/lib/services/clipboard';

type LauncherMode = 'apps' | 'clipboard';
type ListItem = Apps.Application | ClipboardItem;

export default () => {
    const [list, setList] = createState<ListItem[]>(getAppList());
    const [mode, setMode] = createState<LauncherMode>('apps');
    let entryRef: Gtk.Entry | null = null;

    const updateSearch = (text: string) => {
        if (text.startsWith('>')) {
            setMode('clipboard');
            const query = text.slice(1).trim();
            searchClipboard(query, results => setList(results));
        } else {
            setMode('apps');
            setList(fuzzyQuery(text));
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
                } else {
                    entryRef?.set_text('');
                    setList(getAppList());
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
                        close();
                        if (mode() === 'apps') {
                            const results = fuzzyQuery(self.text);
                            if (results.length > 0) results[0].launch();
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