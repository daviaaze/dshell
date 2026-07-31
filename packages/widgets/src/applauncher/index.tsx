import {getHyprland} from '@shade/services/hyprland';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {bind, createState, For} from 'gnim';
import AppButton from './appButton';
import ClipboardButton from './clipboardButton';
import {useSettings} from '@shade/services/settings/index';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '@shade/services/state/windowManager';
import {bus} from '@shade/services/bus';
import ShellState from '@shade/services/state/shellState';
import logger from '@shade/core/logger';
import {launcherSearch} from '@shade/services/search/launcher';
import type {LauncherMode, ListItem} from '@shade/services/search/launcher';
import {fuzzyQuery} from '@shade/services/state/apps';
import {ClipboardEntry} from '@shade/services/clipboard/encryptedStore';
import AstalApps from 'gi://AstalApps?version=0.1';

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;

export default () => {
    const barCfg = useSettings().bar;
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const shellState = ShellState.get_default();
    const [list, setList] = createState<ListItem[]>([]);
    const [mode, setMode] = createState<LauncherMode>('apps');
    const [frecencyHasData, setFrecencyHasData] = createState(false);
    let entryRef: Gtk.Entry | null = null;

    const updateSearch = (text: string) => {
        const result = launcherSearch(text);
        setMode(result.mode);
        setList(result.items);
        setFrecencyHasData(result.frecencyHasData);
    };

    return (
        <Astal.Window
            ref={self => {
                WindowManager.get_default().setApplauncher(self);
                self.connect('realize', () =>
                    logger.log('applauncher realized')
                );
                self.connect('map', () => logger.log('applauncher mapped'));
            }}
            valign={Gtk.Align.CENTER}
            name={'applauncher'}
            margin={12}
            application={getApp()}
            visible={bind(shellState, 'launcherOpen')}
            onNotifyVisible={self => {
                logger.log(`applauncher visible -> ${self.visible}`);
                if (
                    (barCfg.position() === LEFT ||
                        barCfg.position() === RIGHT) &&
                    self.visible &&
                    ShellState.get_default().qsOpen
                )
                    bus.emit('shell:qs:close');
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
                    bus.emit('shell:launcher:close');
                }
            }}
            cssClasses={['card', 'frame', 'background']}
            css={'padding-right:0px;'}
            keymode={Astal.Keymode.ON_DEMAND}
            monitor={bind(hyprland, 'focused-monitor').as(m => m.id)}
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
                    ref={self => {
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
                        ref={self => {
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
                    label={list.as(l => {
                        if (!frecencyHasData() || l.length === 0) return '';
                        return entryRef?.text
                            ? 'Search results (boosted by usage)'
                            : 'Most used apps';
                    })}
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
                                        item={item as ClipboardEntry}
                                    />
                                ) : (
                                    <AppButton
                                        application={
                                            item as AstalApps.Application
                                        }
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
