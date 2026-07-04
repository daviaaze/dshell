import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {For, onCleanup} from 'gnim';
import {app} from '#/App';
import WindowManager from '#/lib/windowManager';
import {Gdk2HyprMonitor, monitors} from '#/lib/monitors';
import {useSettings} from '#/lib/settings';
import SystemIndicators from './systemIndicators';
import SystemUsage from './systemUsage';
import Workspaces from './workspaces';
import BluetoothAudio from './indicators/bluetoothAudio';
import RecordingIndicator from './indicators/recording';
import Clock from './clock';
import Launcher from './launcher';
import {WeatherButton} from './weather';
import WindowTitle from './windowTitle';

export default () => {
    const bar = useSettings().bar;
    const {position} = bar;
    const {TOP, BOTTOM, LEFT, RIGHT} = Astal.WindowAnchor;
    const vertical = position.as(p => p === LEFT || p === RIGHT);

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => (
                <Astal.Window
                    $={self => {
                        WindowManager.get_default().registerBar(self);
                        onCleanup(() => {
                            WindowManager.get_default().unregisterBar(self);
                            self.destroy();
                        });
                    }}
                    visible
                    cssClasses={['card', 'background']}
                    marginTop={position.as(p => (p === BOTTOM ? 0 : 4))}
                    marginLeft={position.as(p => (p === RIGHT ? 0 : 4))}
                    marginBottom={position.as(p => (p === TOP ? 0 : 4))}
                    marginRight={position.as(p => (p === LEFT ? 0 : 4))}
                    application={app}
                    gdkmonitor={monitor}
                    name={`bar-${monitor.get_description()}`}
                    exclusivity={Astal.Exclusivity.EXCLUSIVE}
                    anchor={position.as(p =>
                        p === TOP
                            ? TOP | LEFT | RIGHT
                            : p === LEFT
                              ? TOP | LEFT | BOTTOM
                              : p === BOTTOM
                                ? RIGHT | LEFT | BOTTOM
                                : TOP | RIGHT | BOTTOM
                    )}
                >
                    <Gtk.CenterBox
                        cssClasses={['bar-centerbox']}
                        orientation={vertical.as(v =>
                            v
                                ? Gtk.Orientation.VERTICAL
                                : Gtk.Orientation.HORIZONTAL
                        )}
                    >
                        <Gtk.Box
                            $type="start"
                            cssClasses={['linked']}
                            orientation={vertical.as(v =>
                                v
                                    ? Gtk.Orientation.VERTICAL
                                    : Gtk.Orientation.HORIZONTAL
                            )}
                        >
                            <Launcher visible={bar.showLauncher} />
                            <Gtk.Separator visible={bar.showLauncher} />
                            <SystemUsage
                                vertical={vertical}
                                visible={bar.showSystemResources}
                            />
                        </Gtk.Box>

                        <Gtk.Box
                            $type="center"
                            spacing={8}
                            valign={Gtk.Align.CENTER}
                            halign={Gtk.Align.CENTER}
                            orientation={vertical.as(v =>
                                v
                                    ? Gtk.Orientation.VERTICAL
                                    : Gtk.Orientation.HORIZONTAL
                            )}
                        >
                            <Workspaces
                                vertical={vertical}
                                monitor={Gdk2HyprMonitor(monitor)}
                                visible={bar.showWorkspaces}
                            />
                            <WindowTitle visible={bar.showWindowTitle} />
                        </Gtk.Box>

                        <Gtk.Box
                            $type="end"
                            cssClasses={['linked']}
                            orientation={vertical.as(v =>
                                v
                                    ? Gtk.Orientation.VERTICAL
                                    : Gtk.Orientation.HORIZONTAL
                            )}
                        >
                            <BluetoothAudio />
                            <RecordingIndicator />
                            <Clock
                                vertical={vertical}
                                visible={bar.showClock}
                            />
                            <Gtk.Separator
                                visible={bar.showClock.as(
                                    v => v && bar.showWeather()
                                )}
                            />
                            <WeatherButton
                                vertical={vertical}
                                visible={bar.showWeather}
                            />
                            <Gtk.Separator
                                visible={bar.showWeather.as(
                                    v => v && bar.showSystemIndicators()
                                )}
                            />
                            <SystemIndicators
                                vertical={vertical}
                                visible={bar.showSystemIndicators}
                            />
                        </Gtk.Box>
                    </Gtk.CenterBox>
                </Astal.Window>
            )}
        </For>
    );
};
