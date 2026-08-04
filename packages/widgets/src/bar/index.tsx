import Astal from 'gi://Astal?version=4.0';
import type AstalHyprland from 'gi://AstalHyprland?version=0.1';
import type Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import {Gdk2HyprMonitor, monitors} from '@shade/services/monitoring/monitors';
import {barSettings} from '@shade/services/settings/bar.gschema';
import WindowManager from '@shade/services/state/windowManager';
import {useStyle} from '@shade/style/useStyle';
import {type Accessor, For, onCleanup} from 'gnim';
import Clock from './clock';
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
    const orient = vertical.as((v) => (v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL));

    const styles = useStyle({padding: '4px'});

    return (
        <Gtk.CenterBox ref={styles.$} cssClasses={[styles.class]} orientation={orient}>
            <Gtk.Box slot="start" cssClasses={['linked']} orientation={orient}>
                <Launcher visible={bar.showLauncher} />
                <Gtk.Separator visible={bar.showLauncher} />
                <SystemUsage vertical={vertical} visible={bar.showSystemResources} />
            </Gtk.Box>

            <Gtk.Box
                slot="center"
                spacing={8}
                valign={Gtk.Align.CENTER}
                halign={Gtk.Align.CENTER}
                orientation={orient}
            >
                {hyprMonitor ? (
                    <Workspaces
                        vertical={vertical}
                        monitor={hyprMonitor}
                        visible={bar.showWorkspaces}
                    />
                ) : null}
                <WindowTitle visible={bar.showWindowTitle} />
            </Gtk.Box>

            <Gtk.Box slot="end" cssClasses={['linked']} orientation={orient}>
                <BluetoothAudio />
                <RecordingIndicator />
                <Clock vertical={vertical} visible={bar.showClock} />
                <Gtk.Separator visible={bar.showClock.as((v) => v && bar.showWeather())} />
                <WeatherButton vertical={vertical} visible={bar.showWeather} />
                <Gtk.Separator
                    visible={bar.showWeather.as((v) => v && bar.showSystemIndicators())}
                />
                <SystemIndicators vertical={vertical} visible={bar.showSystemIndicators} />
            </Gtk.Box>
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
            cssClasses={['background']}
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
            <BarContent bar={bar} vertical={vertical} hyprMonitor={hyprMonitor} />
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
