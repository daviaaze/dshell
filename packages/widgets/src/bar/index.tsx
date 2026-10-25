import Astal from 'gi://Astal?version=4.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import type Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import {Gdk2HyprMonitor, monitors} from '@shade/services/monitoring/monitors';
import {barSettings} from '@shade/services/settings/bar.gschema';
import Screenshot from '@shade/services/capture/screenshot';
import WindowManager from '@shade/services/state/windowManager';
import {type Accessor, bind, computed, For, onCleanup, type JSX} from 'gnim';
import Clock from './clock';
import {BAR_EDGE_RESERVE} from './geometry';
import BluetoothAudio from './indicators/bluetoothAudio';
import RecordingIndicator from './indicators/recording';
import Launcher from './launcher';
import SystemIndicators from './systemIndicators';
import SystemUsage from './systemUsage';
import {WeatherButton} from './weather';
import WindowTitle from './windowTitle';
import Workspaces from './workspaces';

const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;
const BAR_MARGIN = 4;

type Bar = ReturnType<typeof barSettings>;

interface BarClusterProps {
    slot: 'start' | 'center' | 'end';
    vertical: Accessor<boolean>;
    visible: boolean | Accessor<boolean>;
    children: JSX.Element | JSX.Element[];
}

/** A task-related group, using libadwaita's native card surface and flat controls. */
function BarCluster({slot, vertical, visible, children}: BarClusterProps) {
    const orientation = vertical.as((v) =>
        v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
    );

    return (
        <Gtk.Box
            slot={slot}
            visible={visible}
            cssClasses={['card']}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
        >
            <Gtk.Box
                orientation={orientation}
                spacing={vertical.as((v) => (v ? 4 : 8))}
                marginTop={4}
                marginBottom={4}
                marginStart={4}
                marginEnd={4}
            >
                {children}
            </Gtk.Box>
        </Gtk.Box>
    );
}

/** Bar contents: start (launcher/usage), center (workspaces/title), end (indicators). */
function BarContent({
    bar,
    vertical,
    hyprMonitor,
}: {
    bar: Bar;
    vertical: Accessor<boolean>;
    hyprMonitor: AstalHyprland.Monitor | null;
}) {
    const recording = bind(Screenshot.get_default(), 'recording');
    const showStart = computed(() => bar.showLauncher() || bar.showSystemResources());
    const showCenter = computed(
        () => hyprMonitor !== null && (bar.showWorkspaces() || bar.showWindowTitle())
    );
    const showEnd = computed(
        () =>
            bar.showClock() ||
            bar.showWeather() ||
            bar.showSystemIndicators() ||
            bar.showBluetoothBattery() ||
            recording()
    );
    const orient = vertical.as((v) => (v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL));

    return (
        <Gtk.CenterBox
            marginTop={4}
            marginBottom={4}
            marginStart={vertical.as((v) => (v ? 0 : 4))}
            marginEnd={vertical.as((v) => (v ? 0 : 4))}
            orientation={orient}
        >
            <BarCluster slot="start" vertical={vertical} visible={showStart}>
                <Launcher visible={bar.showLauncher} />
                <Gtk.Separator
                    orientation={vertical.as((v) =>
                        v ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL
                    )}
                    visible={bar.showLauncher.as((v) => v && bar.showSystemResources())}
                />
                <SystemUsage vertical={vertical} visible={bar.showSystemResources} />
            </BarCluster>

            <BarCluster slot="center" vertical={vertical} visible={showCenter}>
                {hyprMonitor && bar.showWorkspaces() ? (
                    <Workspaces
                        vertical={vertical}
                        monitor={hyprMonitor}
                        visible={bar.showWorkspaces}
                    />
                ) : null}
                <WindowTitle vertical={vertical} visible={bar.showWindowTitle} />
            </BarCluster>

            <BarCluster slot="end" vertical={vertical} visible={showEnd}>
                <BluetoothAudio vertical={vertical} />
                <RecordingIndicator vertical={vertical} />
                <Clock vertical={vertical} visible={bar.showClock} />
                <Gtk.Separator
                    orientation={vertical.as((v) =>
                        v ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL
                    )}
                    visible={bar.showClock.as((v) => v && bar.showWeather())}
                />
                <WeatherButton vertical={vertical} visible={bar.showWeather} />
                <Gtk.Separator
                    orientation={vertical.as((v) =>
                        v ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL
                    )}
                    visible={bar.showWeather.as((v) => v && bar.showSystemIndicators())}
                />
                <SystemIndicators vertical={vertical} visible={bar.showSystemIndicators} />
            </BarCluster>
        </Gtk.CenterBox>
    );
}

/** One bar window for a single GDK monitor. */
function BarWindow({
    bar,
    monitor,
    vertical,
}: {
    bar: Bar;
    monitor: Gdk.Monitor;
    vertical: Accessor<boolean>;
}) {
    const {position} = bar;
    const hyprMonitor = Gdk2HyprMonitor(monitor);

    return (
        <Astal.Window
            ref={(self) => {
                WindowManager.get_default().registerBar(self);
                onCleanup(() => {
                    WindowManager.get_default().unregisterBar(self);
                    self.close();
                });
            }}
            visible
            cssClasses={['bar-window']}
            marginTop={position.as((p) => (p === BOTTOM ? 0 : BAR_MARGIN))}
            marginLeft={position.as((p) => (p === RIGHT ? 0 : BAR_MARGIN))}
            marginBottom={position.as((p) => (p === TOP ? 0 : BAR_MARGIN))}
            marginRight={position.as((p) => (p === LEFT ? 0 : BAR_MARGIN))}
            application={getApp()}
            gdkmonitor={monitor}
            name={`bar-${monitor.get_description()}`}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={position.as((p) => {
                if (p === TOP) return TOP | LEFT | RIGHT;
                if (p === LEFT) return TOP | LEFT | BOTTOM;
                if (p === BOTTOM) return RIGHT | LEFT | BOTTOM;
                return TOP | RIGHT | BOTTOM;
            })}
        >
            <For each={vertical.as((v) => [v])}>
                {(isVertical: boolean) => {
                    const content = (
                        <BarContent bar={bar} vertical={vertical} hyprMonitor={hyprMonitor} />
                    );
                    return isVertical ? (
                        <Gtk.ScrolledWindow
                            widthRequest={BAR_EDGE_RESERVE}
                            minContentWidth={BAR_EDGE_RESERVE}
                            maxContentWidth={BAR_EDGE_RESERVE}
                            propagateNaturalWidth
                            hscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
                            vscrollbarPolicy={Gtk.PolicyType.NEVER}
                        >
                            {content}
                        </Gtk.ScrolledWindow>
                    ) : (
                        content
                    );
                }}
            </For>
        </Astal.Window>
    );
}

export default () => {
    const bar = barSettings();
    const {position} = bar;
    const vertical = position.as((p) => p === LEFT || p === RIGHT);

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <BarWindow bar={bar} monitor={monitor} vertical={vertical} />
            )}
        </For>
    );
};
