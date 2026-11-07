import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {getApp} from '@shade/services/appHandle';
import LayoutService from '@shade/services/display/layouts';
import {getHyprland} from '@shade/services/hyprland';
import {barSettings} from '@shade/services/settings/bar.gschema';
import ShellState from '@shade/services/state/shellState';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, createState, onCleanup} from 'gnim';
import {BAR_EDGE_RESERVE} from '../bar/geometry';
import {PowerMenu} from '../common/powerMenu';
import {openSettings} from '../settings/settingsOpen';
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
import AppMixer from './appMixer';
import {TrayBox} from './tray';

const PANEL_WIDTH = 420;
const WINDOW_MARGIN = 4;
type QuickRoute = 'home' | 'wifi' | 'bluetooth' | 'audio' | 'microphone' | 'mixer' | 'displays' | 'other' | 'data' | OtherRoute;
const TITLES: Record<QuickRoute, string> = {
    home: 'Controles rápidos', wifi: 'Wi-Fi', bluetooth: 'Bluetooth',
    audio: 'Saída de áudio', microphone: 'Microfone', mixer: 'Mixer de aplicativos', displays: 'Telas',
    other: 'Outros controles', data: 'Data e clima', profile: 'Energia',
    appearance: 'Aparência', capture: 'Captura', inhibit: 'Manter ativo',
    timer: 'Temporizador', nightlight: 'Luz noturna',
};

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const state = ShellState.get_default();
    const layouts = LayoutService.get_default();
    const bar = barSettings();
    const [route, setRoute] = createState<QuickRoute>('home');
    const [navigationError, setNavigationError] = createState('');
    const [headerHeight, setHeaderHeight] = createState(0);
    const monitor = bind(hyprland, 'focused-monitor');
    const {TOP, LEFT, RIGHT} = Astal.WindowAnchor;
    const sidebar = computed(() => bar.position() === LEFT || bar.position() === RIGHT);
    const width = computed(() => {
        const current = monitor();
        const available = current ? current.width / (current.scale || 1) : PANEL_WIDTH + WINDOW_MARGIN * 2;
        return Math.max(1, Math.min(PANEL_WIDTH, available - WINDOW_MARGIN * 2 - (sidebar() ? BAR_EDGE_RESERVE : 0)));
    });
    const maxHeight = computed(() => {
        const current = monitor();
        const available = current ? current.height / (current.scale || 1) : 720;
        return Math.max(1, available - WINDOW_MARGIN * 2 - headerHeight() - (sidebar() ? 0 : BAR_EDGE_RESERVE));
    });
    const history: {route: QuickRoute; origin: Gtk.Widget}[] = [];
    let focusSource = 0;
    let alive = true;
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
        if (route() !== 'displays') { next(); return; }
        void layouts.revert().then(() => { if (alive) next(); }).catch(error => {
            if (alive) setNavigationError(`Não foi possível reverter as alterações de tela: ${String(error)}`);
        });
    };
    const navigate = (destination: QuickRoute, self: Gtk.Button) => {
        history.push({route: route(), origin: self});
        setNavigationError('');
        setRoute(destination);
    };
    const wifi = WifiQuickButton(self => navigate('wifi', self));
    const bluetooth = BluetoothQuickButton(self => navigate('bluetooth', self));
    const other = createOtherControls((destination, self) => navigate(destination, self));
    const title = computed(() => other.pages.find(page => page.id === route())?.title ?? TITLES[route()]);
    onCleanup(() => {
        alive = false;
        if (focusSource) GLib.source_remove(focusSource);
    });

    return (
        <Astal.Window name="quicksettings" namespace="shade-quicksettings" application={getApp()}
            title={title} resizable={false}
            keymode={Astal.Keymode.ON_DEMAND} visible={bind(state, 'qsOpen')}
            anchor={bar.position.as(position => TOP | (position === LEFT ? LEFT : RIGHT))}
            marginTop={WINDOW_MARGIN} marginBottom={WINDOW_MARGIN} marginStart={WINDOW_MARGIN} marginEnd={WINDOW_MARGIN}
            monitor={monitor.as(monitorIndexFromHyprland)} widthRequest={width}
            cssClasses={[]} css="background-color: transparent;"
            ref={self => {
                const manager = WindowManager.get_default();
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
            onNotifyVisible={self => {
                state.qsOpen = self.visible;
                if (!self.visible) {
                    const leavingDisplays = route() === 'displays';
                    setRoute('home');
                    history.length = 0;
                    if (leavingDisplays) void layouts.revert().catch(error =>
                        logger.warn('quicksettings', 'display rollback failed:', error));
                }
            }}>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['card', 'vertical']}>
                <Adw.HeaderBar showStartTitleButtons={false} showEndTitleButtons={false}
                    ref={self => setHeaderHeight(self.measure(Gtk.Orientation.VERTICAL, -1)[1])}>
                    <Gtk.Button slot="start" visible={route.as(value => value !== 'home')}
                        iconName="go-previous-symbolic" tooltipText="Voltar"
                        onClicked={() => leavePage(goBack)} />
                    <Gtk.Button slot="start" visible={route.as(value => value === 'home')}
                        iconName="preferences-system-symbolic" tooltipText="Configurações"
                        ref={self => self.update_property([Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Configurações')])}
                        onClicked={() => openSettings()} />
                    <Adw.WindowTitle slot="title" title={title} />
                    <Gtk.MenuButton slot="end" visible={route.as(value => value === 'home')}
                        iconName="system-shutdown-symbolic" tooltipText="Sessão e energia"
                        ref={self => self.update_property([Gtk.AccessibleProperty.LABEL],
                            [new GObject.Value(GObject.TYPE_STRING, 'Sessão e energia')])}>
                        <PowerMenu />
                    </Gtk.MenuButton>
                    <Gtk.Button slot="end" iconName="window-close-symbolic" tooltipText="Fechar controles rápidos"
                        onClicked={() => leavePage(() => state.closeQuickSettings())} />
                </Adw.HeaderBar>
                <Gtk.Label visible={navigationError.as(Boolean)} label={navigationError} wrap
                    cssClasses={['error']} marginStart={16} marginEnd={16} />
                <Gtk.ScrolledWindow propagateNaturalHeight maxContentHeight={maxHeight}
                    hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    <Gtk.Stack visibleChildName={route} hhomogeneous={false} vhomogeneous={false}
                        transitionType={Gtk.StackTransitionType.CROSSFADE}
                        marginTop={16} marginBottom={16} marginStart={16} marginEnd={16}>
                        <Gtk.Box name="home" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={16}>
                            <Gtk.Label label="Conexões" cssClasses={['heading']} xalign={0} />
                            <Gtk.FlowBox selectionMode={Gtk.SelectionMode.NONE} minChildrenPerLine={1}
                                maxChildrenPerLine={2} homogeneous columnSpacing={8} rowSpacing={8}>
                                {wifi.widget}{bluetooth.widget}
                            </Gtk.FlowBox>
                            <Gtk.Label label="Tela e som" cssClasses={['heading']} xalign={0} />
                            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={['card', 'frame', 'vertical']}>
                                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={16}
                                    marginTop={12} marginBottom={12} marginStart={12} marginEnd={12}>
                                    <BrightnessSlider onOpen={self => navigate('displays', self)} />
                                    <AudioCompact onOpen={self => navigate('audio', self)} />
                                    <MicCompact onOpen={self => navigate('microphone', self)} />
                                </Gtk.Box>
                            </Gtk.Box>
                            <Gtk.Button onClicked={self => navigate('other', self)}>
                                <Gtk.Box spacing={12}>
                                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand>
                                        <Gtk.Label label="Outros controles" xalign={0} />
                                        <Gtk.Label label="Energia, aparência, captura e timer" wrap xalign={0} cssClasses={['caption', 'dimmed']} />
                                    </Gtk.Box>
                                    <Gtk.Image iconName="go-next-symbolic" />
                                </Gtk.Box>
                            </Gtk.Button>
                            <Gtk.Box spacing={8} homogeneous>
                                <Gtk.Button label="Data e clima" onClicked={self => navigate('data', self)} />
                                <Gtk.Button label="Notificações" onClicked={() => state.openNotifications()} />
                            </Gtk.Box>
                        </Gtk.Box>
                        <Gtk.Box name="wifi" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            {wifi.detail}
                            <Gtk.Button label="Configurações de rede" onClicked={() => openSettings('network')} />
                        </Gtk.Box>
                        <Gtk.Box name="bluetooth" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            {bluetooth.detail}
                            <Gtk.Button label="Configurações de Bluetooth" onClicked={() => openSettings('bluetooth')} />
                        </Gtk.Box>
                        <Gtk.Box name="audio" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            <AudioConfig onOpenMixer={self => navigate('mixer', self)} />
                            <Gtk.Button label="Configurações de som" onClicked={() => openSettings('sound')} />
                        </Gtk.Box>
                        <Gtk.Box name="microphone" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            <MicConfig /><Gtk.Button label="Configurações de som" onClicked={() => openSettings('sound')} />
                        </Gtk.Box>
                        <Gtk.Box name="mixer" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            <AppMixer />
                        </Gtk.Box>
                        <Gtk.Box name="displays" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                            <DisplaySection /><Gtk.Button label="Configurações de telas"
                                onClicked={() => leavePage(() => openSettings('displays'))} />
                        </Gtk.Box>
                        <Gtk.Box name="other" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={16}>
                            <ReactiveGrid items={other.buttons} cols={2} /><Battery /><Media /><TrayBox />
                        </Gtk.Box>
                        <Gtk.Box name="data" slot="named" orientation={Gtk.Orientation.VERTICAL} spacing={16}>
                            <Calendar /><Weather /><WorldClock />
                            <Gtk.Button label="Configurações de clima" onClicked={() => openSettings('weather')} />
                        </Gtk.Box>
                        {other.pages.map(page => <Gtk.Box name={page.id} slot="named"
                            orientation={Gtk.Orientation.VERTICAL} spacing={12}>{page.body}</Gtk.Box>)}
                    </Gtk.Stack>
                </Gtk.ScrolledWindow>
            </Gtk.Box>
        </Astal.Window>
    );
};
