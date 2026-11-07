import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import LayoutService from '@shade/services/display/layouts';
import {logicalMonitorSize} from '@shade/services/display/modes';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, createState, effect, onCleanup} from 'gnim';
import {BAR_EDGE_RESERVE} from '../bar/geometry';
import {PowerMenu} from '../common/powerMenu';
import {openSettings} from '../settings/settingsOpen';
import AppMixer from './appMixer';
import BluetoothQuickButton from './button-grid/bluetooth';
import {createOtherControls, type OtherRoute} from './button-grid/index';
import {ReactiveGrid} from './button-grid/reactiveGrid';
import {DisplaySection} from './display';
import {Battery} from './expander/battery';
import {Calendar} from './expander/calendar';
import {Media} from './expander/media';
import {Weather} from './expander/weather';
import {WorldClock} from './expander/worldClock';
import WifiQuickButton from './network';
import {AudioCompact, AudioConfig, BrightnessSlider, MicCompact, MicConfig} from './sliders';
import {TrayBox} from './tray';

const PANEL_WIDTH = 420;
const WINDOW_MARGIN = 4;

type QuickRoute =
    | 'home'
    | 'wifi'
    | 'bluetooth'
    | 'audio'
    | 'microphone'
    | 'mixer'
    | 'displays'
    | 'other'
    | 'data'
    | OtherRoute;
const TITLES: Record<QuickRoute, string> = {
    home: 'Controles rápidos',
    wifi: 'Wi-Fi',
    bluetooth: 'Bluetooth',
    audio: 'Saída de áudio',
    microphone: 'Microfone',
    mixer: 'Mixer de aplicativos',
    displays: 'Telas',
    other: 'Outros controles',
    data: 'Data e clima',
    profile: 'Energia',
    appearance: 'Aparência',
    capture: 'Captura',
    inhibit: 'Manter ativo',
    timer: 'Temporizador',
    nightlight: 'Luz noturna',
};

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const state = ShellState.get_default();
    const qsOpen = bind(state, 'qsOpen');
    const layouts = LayoutService.get_default();
    const manager = WindowManager.get_default();
    const bars = bind(manager, 'bars');
    const [chrome, setChrome] = createState(0);
    let header: Adw.HeaderBar | undefined;
    let card: Gtk.Box | undefined;
    let errorLabel: Gtk.Label | undefined;
    let advancedButton: Gtk.Button | undefined;
    let measureSource = 0;
    const bar = barSettings();
    const [route, setRoute] = createState<QuickRoute>('home');
    const [navigationError, setNavigationError] = createState('');
    const monitor = bind(hyprland, 'focused-monitor');
    let watchedMonitor: AstalHyprland.Monitor | null = null;
    let monitorSignals: number[] = [];
    const [monitorVersion, setMonitorVersion] = createState(0);
    const {TOP, LEFT, RIGHT} = Astal.WindowAnchor;
    const sidebar = computed(() => bar.position() === LEFT || bar.position() === RIGHT);
    const monitorSize = computed(() => {
        monitorVersion();
        const current = monitor();
        if (!current) return null;
        const output = {
            name: current.name,
            resolution: 'preferred',
            position: `${current.x}x${current.y}`,
            scale: current.scale,
            transform: current.transform,
            vrr: null,
            disabled: false,
            mirror: null,
            id: current.id,
            enabled: true,
            dpms: true,
            width: current.width,
            height: current.height,
            x: current.x,
            y: current.y,
            modes: [],
        };
        return logicalMonitorSize(output, output);
    });
    const maxContentHeight = computed(() => {
        const available = monitorSize()?.height ?? 720;
        return Math.max(1, available - WINDOW_MARGIN * 2 - chrome());
    });
    const width = computed(() => {
        const available = monitorSize()?.width ?? PANEL_WIDTH + WINDOW_MARGIN * 2;
        return Math.max(
            1,
            Math.min(
                PANEL_WIDTH,
                available - WINDOW_MARGIN * 2 - (sidebar() ? BAR_EDGE_RESERVE : 0)
            )
        );
    });
    const history: {route: QuickRoute; origin: Gtk.Widget}[] = [];
    let focusSource = 0;
    let alive = true;
    const scheduleMeasure = () => {
        if (!alive || measureSource) return;
        measureSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            measureSource = 0;
            if (!alive || !header || !card || !card.get_root()) return GLib.SOURCE_REMOVE;
            const current = monitor();
            const panelWidth = width();
            const style = card.get_style_context();
            const padding = style.get_padding();
            const border = style.get_border();
            // Astal swaps vertical reservation names; the IPC values are already logical.
            const barReserved = current ? current.reservedBottom + current.reservedRight : 0;
            const errorHeight =
                navigationError() && errorLabel
                    ? errorLabel.measure(Gtk.Orientation.VERTICAL, Math.floor(panelWidth))[1]
                    : 0;
            const footerHeight = advancedButton?.get_visible()
                ? advancedButton.measure(Gtk.Orientation.VERTICAL, Math.floor(panelWidth))[1] + 20
                : 0;
            setChrome(
                header.measure(Gtk.Orientation.VERTICAL, Math.floor(panelWidth))[1] +
                    errorHeight +
                    padding.top +
                    padding.bottom +
                    border.top +
                    border.bottom +
                    barReserved +
                    footerHeight
            );
            // Gtk.Window retains its previous allocation as the default size.
            // Re-request natural sizing after updating the real content cap.
            manager.quicksettings?.set_default_size(-1, -1);
            return GLib.SOURCE_REMOVE;
        });
    };
    const refreshMonitors = () => {
        hyprland.sync_monitors((_source, result) => {
            try {
                hyprland.sync_monitors_finish(result);
            } catch (error) {
                logger.warn('quicksettings', 'monitor refresh failed:', error);
            }
            scheduleMeasure();
        });
    };
    const hyprlandSignals = [
        hyprland.connect('config-reloaded', refreshMonitors),
        hyprland.connect('monitor-added', refreshMonitors),
        hyprland.connect('monitor-removed', refreshMonitors),
    ];
    effect(() => {
        const current = monitor();
        if (current !== watchedMonitor) {
            if (watchedMonitor) {
                for (const handler of monitorSignals) watchedMonitor.disconnect(handler);
            }
            watchedMonitor = current;
            monitorSignals = current
                ? [
                      current.connect('notify::width', () => {
                          setMonitorVersion((value) => value + 1);
                          scheduleMeasure();
                      }),
                      ...(
                          [
                              'notify::height',
                              'notify::scale',
                              'notify::transform',
                              'notify::reserved-bottom',
                              'notify::reserved-right',
                          ] as const
                      ).map((signal) =>
                          current.connect(signal, () => {
                              setMonitorVersion((value) => value + 1);
                              scheduleMeasure();
                          })
                      ),
                  ]
                : [];
        }
        bar.position();
        bars();
        width();
        qsOpen();
        route();
        navigationError();
        scheduleMeasure();
    });
    const goBack = () => {
        const previous = history.pop();
        setRoute(previous?.route ?? 'home');
        if (focusSource) GLib.source_remove(focusSource);
        focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            focusSource = 0;
            if (previous?.origin.get_mapped()) previous.origin.grab_focus();
            return GLib.SOURCE_REMOVE;
        });
    };
    const leavePage = (next: () => void) => {
        if (route() !== 'displays') {
            next();
            return;
        }
        void layouts
            .revert()
            .then(() => {
                if (alive) next();
            })
            .catch((error) => {
                if (alive)
                    setNavigationError(
                        `Não foi possível reverter as alterações de tela: ${String(error)}`
                    );
            });
    };
    const navigate = (destination: QuickRoute, self: Gtk.Button) => {
        history.push({route: route(), origin: self});
        setNavigationError('');
        setRoute(destination);
    };
    const wifi = WifiQuickButton((self) => navigate('wifi', self));
    const bluetooth = BluetoothQuickButton((self) => navigate('bluetooth', self));
    const other = createOtherControls((destination, self) => navigate(destination, self));
    const openDisplays = () => {
        if (route() === 'displays') return;
        history.length = 0;
        setNavigationError('');
        setRoute('displays');
    };
    const chooserSignal = layouts.connect('mode-chooser-requested', openDisplays);
    const externalPreviewSignal = layouts.connect('external-preview-requested', openDisplays);
    const title = computed(
        () => other.pages.find((page) => page.id === route())?.title ?? TITLES[route()]
    );
    onCleanup(() => {
        layouts.disconnect(chooserSignal);
        layouts.disconnect(externalPreviewSignal);
        for (const handler of hyprlandSignals) hyprland.disconnect(handler);
        if (watchedMonitor) {
            for (const handler of monitorSignals) watchedMonitor.disconnect(handler);
        }
        alive = false;
        if (focusSource) GLib.source_remove(focusSource);
        if (measureSource) GLib.source_remove(measureSource);
    });

    return (
        <Astal.Window
            name="quicksettings"
            namespace="shade-quicksettings"
            application={getApp()}
            title={title}
            resizable={false}
            keymode={Astal.Keymode.ON_DEMAND}
            visible={qsOpen}
            anchor={bar.position.as((position) => TOP | (position === LEFT ? LEFT : RIGHT))}
            margin={WINDOW_MARGIN}
            monitor={monitor.as(monitorIndexFromHyprland)}
            widthRequest={width}
            cssClasses={[]}
            css="background-color: transparent; padding: 0; border: none; min-height: 0;"
            ref={(self) => {
                scheduleMeasure();
                manager.setQuicksettings(self);
                const keys = Gtk.EventControllerKey.new();
                keys.connect('key-pressed', (_controller, key) => {
                    if (key !== Gdk.KEY_Escape || !self.visible) return false;
                    leavePage(route() === 'home' ? () => state.closeQuickSettings() : goBack);
                    return true;
                });
                self.add_controller(keys);
                onCleanup(() => {
                    self.remove_controller(keys);
                    if (manager.quicksettings === self) manager.setQuicksettings(null);
                });
            }}
            onMap={scheduleMeasure}
            onNotifyVisible={(self) => {
                state.qsOpen = self.visible;
                if (self.visible) {
                    refreshMonitors();
                    scheduleMeasure();
                }
                if (!self.visible) {
                    const leavingDisplays = route() === 'displays';
                    setRoute('home');
                    history.length = 0;
                    if (leavingDisplays)
                        void layouts
                            .revert()
                            .catch((error) =>
                                logger.warn('quicksettings', 'display rollback failed:', error)
                            );
                }
            }}
        >
            <Gtk.ScrolledWindow
                propagateNaturalWidth={false}
                propagateNaturalHeight
                minContentHeight={0}
                maxContentHeight={maxContentHeight}
                overlayScrolling
                hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                vscrollbarPolicy={Gtk.PolicyType.NEVER}
            >
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    cssClasses={['card', 'vertical']}
                    ref={(self) => {
                        card = self;
                        scheduleMeasure();
                    }}
                >
                    <Adw.HeaderBar
                        showStartTitleButtons={false}
                        showEndTitleButtons={false}
                        ref={(self) => {
                            header = self;
                            scheduleMeasure();
                        }}
                    >
                        <Gtk.Button
                            slot="start"
                            visible={route.as((value) => value !== 'home')}
                            iconName="go-previous-symbolic"
                            tooltipText="Voltar"
                            ref={(self) =>
                                self.update_property(
                                    [Gtk.AccessibleProperty.LABEL],
                                    [new GObject.Value(GObject.TYPE_STRING, 'Voltar')]
                                )
                            }
                            onClicked={() => leavePage(goBack)}
                        />
                        <Gtk.Button
                            slot="start"
                            visible={route.as((value) => value === 'home')}
                            iconName="preferences-system-symbolic"
                            tooltipText="Configurações"
                            ref={(self) =>
                                self.update_property(
                                    [Gtk.AccessibleProperty.LABEL],
                                    [new GObject.Value(GObject.TYPE_STRING, 'Configurações')]
                                )
                            }
                            onClicked={() => openSettings()}
                        />
                        <Adw.WindowTitle slot="title" title={title} />
                        <Gtk.MenuButton
                            slot="end"
                            visible={route.as((value) => value === 'home')}
                            iconName="system-shutdown-symbolic"
                            tooltipText="Sessão e energia"
                            ref={(self) =>
                                self.update_property(
                                    [Gtk.AccessibleProperty.LABEL],
                                    [new GObject.Value(GObject.TYPE_STRING, 'Sessão e energia')]
                                )
                            }
                        >
                            <PowerMenu />
                        </Gtk.MenuButton>
                        <Gtk.Button
                            slot="end"
                            iconName="window-close-symbolic"
                            tooltipText="Fechar controles rápidos"
                            onClicked={() => leavePage(() => state.closeQuickSettings())}
                        />
                    </Adw.HeaderBar>
                    <Gtk.Label
                        visible={navigationError.as(Boolean)}
                        label={navigationError}
                        wrap
                        cssClasses={['error']}
                        marginStart={16}
                        marginEnd={16}
                        ref={(self) => {
                            errorLabel = self;
                            scheduleMeasure();
                        }}
                    />
                    <Gtk.ScrolledWindow
                        propagateNaturalHeight
                        minContentHeight={0}
                        maxContentHeight={maxContentHeight}
                        hscrollbarPolicy={Gtk.PolicyType.NEVER}
                        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
                    >
                        <Gtk.Stack
                            visibleChildName={route}
                            hhomogeneous={false}
                            vhomogeneous={false}
                            transitionType={Gtk.StackTransitionType.CROSSFADE}
                            marginTop={16}
                            marginBottom={16}
                            marginStart={16}
                            marginEnd={16}
                        >
                            <Gtk.Box
                                name="home"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={16}
                            >
                                <Gtk.Label label="Conexões" cssClasses={['heading']} xalign={0} />
                                <Gtk.FlowBox
                                    selectionMode={Gtk.SelectionMode.NONE}
                                    minChildrenPerLine={1}
                                    maxChildrenPerLine={2}
                                    homogeneous
                                    columnSpacing={8}
                                    rowSpacing={8}
                                >
                                    {wifi.widget}
                                    {bluetooth.widget}
                                </Gtk.FlowBox>
                                <Gtk.Label label="Tela e som" cssClasses={['heading']} xalign={0} />
                                <Gtk.Box
                                    orientation={Gtk.Orientation.VERTICAL}
                                    cssClasses={['card', 'frame', 'vertical']}
                                >
                                    <Gtk.Box
                                        orientation={Gtk.Orientation.VERTICAL}
                                        spacing={16}
                                        marginTop={12}
                                        marginBottom={12}
                                        marginStart={12}
                                        marginEnd={12}
                                    >
                                        <BrightnessSlider />
                                        <AudioCompact onOpen={(self) => navigate('audio', self)} />
                                        <MicCompact
                                            onOpen={(self) => navigate('microphone', self)}
                                        />
                                    </Gtk.Box>
                                </Gtk.Box>
                                <Gtk.Button onClicked={(self) => navigate('displays', self)}>
                                    <Gtk.Box spacing={12}>
                                        <Gtk.Image iconName="video-display-symbolic" />
                                        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
                                            <Gtk.Label label="Telas" xalign={0} />
                                            <Gtk.Label
                                                label="Modos, monitores e layouts salvos"
                                                wrap
                                                xalign={0}
                                                cssClasses={['caption', 'dimmed']}
                                            />
                                        </Gtk.Box>
                                        <Gtk.Image iconName="go-next-symbolic" />
                                    </Gtk.Box>
                                </Gtk.Button>
                                <Gtk.Button onClicked={(self) => navigate('other', self)}>
                                    <Gtk.Box spacing={12}>
                                        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
                                            <Gtk.Label label="Outros controles" xalign={0} />
                                            <Gtk.Label
                                                label="Energia, aparência, captura e timer"
                                                wrap
                                                xalign={0}
                                                cssClasses={['caption', 'dimmed']}
                                            />
                                        </Gtk.Box>
                                        <Gtk.Image iconName="go-next-symbolic" />
                                    </Gtk.Box>
                                </Gtk.Button>
                                <Gtk.Box spacing={8} homogeneous>
                                    <Gtk.Button
                                        label="Data e clima"
                                        onClicked={(self) => navigate('data', self)}
                                    />
                                    <Gtk.Button
                                        label="Notificações"
                                        onClicked={() => state.openNotifications()}
                                    />
                                </Gtk.Box>
                            </Gtk.Box>
                            <Gtk.Box
                                name="wifi"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                {wifi.detail}
                                <Gtk.Button
                                    label="Configurações de rede"
                                    onClicked={() => openSettings('network')}
                                />
                            </Gtk.Box>
                            <Gtk.Box
                                name="bluetooth"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                {bluetooth.detail}
                                <Gtk.Button
                                    label="Configurações de Bluetooth"
                                    onClicked={() => openSettings('bluetooth')}
                                />
                            </Gtk.Box>
                            <Gtk.Box
                                name="audio"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                <AudioConfig onOpenMixer={(self) => navigate('mixer', self)} />
                                <Gtk.Button
                                    label="Configurações de som"
                                    onClicked={() => openSettings('sound')}
                                />
                            </Gtk.Box>
                            <Gtk.Box
                                name="microphone"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                <MicConfig />
                                <Gtk.Button
                                    label="Configurações de som"
                                    onClicked={() => openSettings('sound')}
                                />
                            </Gtk.Box>
                            <Gtk.Box
                                name="mixer"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                <AppMixer />
                            </Gtk.Box>
                            <Gtk.Box
                                name="displays"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={12}
                            >
                                <DisplaySection />
                            </Gtk.Box>
                            <Gtk.Box
                                name="other"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={16}
                            >
                                <ReactiveGrid items={other.buttons} cols={2} />
                                <Battery />
                                <Media />
                                <TrayBox />
                            </Gtk.Box>
                            <Gtk.Box
                                name="data"
                                slot="named"
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={16}
                            >
                                <Calendar />
                                <Weather />
                                <WorldClock />
                                <Gtk.Button
                                    label="Configurações de clima"
                                    onClicked={() => openSettings('weather')}
                                />
                            </Gtk.Box>
                            {other.pages.map((page) => (
                                <Gtk.Box
                                    name={page.id}
                                    slot="named"
                                    orientation={Gtk.Orientation.VERTICAL}
                                    spacing={12}
                                >
                                    {page.body}
                                </Gtk.Box>
                            ))}
                        </Gtk.Stack>
                    </Gtk.ScrolledWindow>
                    <Gtk.Button
                        label="Configurações de telas"
                        visible={route.as((value) => value === 'displays')}
                        marginStart={16}
                        marginEnd={16}
                        marginTop={8}
                        marginBottom={12}
                        onClicked={() => leavePage(() => openSettings('displays'))}
                        ref={(self) => {
                            advancedButton = self;
                            scheduleMeasure();
                        }}
                    />
                </Gtk.Box>
            </Gtk.ScrolledWindow>
        </Astal.Window>
    );
};
