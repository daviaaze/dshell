import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {For, onCleanup} from 'gnim';
import {getApp} from '@shade/services/appHandle';
import WindowManager from '../../lib/services/state/windowManager';
import {Gdk2HyprMonitor, monitors} from '@shade/services/monitoring/monitors';
import {useSettings} from '@shade/services/settings/index';
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
    const BAR_MARGIN = 4;

    return (
        <For each={monitors}>
            {(monitor: Gdk.Monitor) => {
                const hyprMonitor = Gdk2HyprMonitor(monitor);
                return (
                    <Astal.Window
                    ref={self => {
                        WindowManager.get_default().registerBar(self);
                        onCleanup(() => {
                            WindowManager.get_default().unregisterBar(self);
                            self.close();
                        });
                    }}
                    visible
                    cssClasses={['card', 'background']}
                    marginTop={position.as(p =>
                        p === BOTTOM ? 0 : BAR_MARGIN
                    )}
                    marginLeft={position.as(p =>
                        p === RIGHT ? 0 : BAR_MARGIN
                    )}
                    marginBottom={position.as(p =>
                        p === TOP ? 0 : BAR_MARGIN
                    )}
                    marginRight={position.as(p =>
                        p === LEFT ? 0 : BAR_MARGIN
                    )}
                    application={getApp()}
                    gdkmonitor={monitor}
                    name={`bar-${monitor.get_description()}`}
                    exclusivity={Astal.Exclusivity.EXCLUSIVE}
                    anchor={position.as(p => {
                        if (p === TOP) return TOP | LEFT | RIGHT;
                        if (p === LEFT) return TOP | LEFT | BOTTOM;
                        if (p === BOTTOM) return RIGHT | LEFT | BOTTOM;
                        return TOP | RIGHT | BOTTOM;
                    })}
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
                            slot="start"
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
                            slot="center"
                            spacing={8}
                            valign={Gtk.Align.CENTER}
                            halign={Gtk.Align.CENTER}
                            orientation={vertical.as(v =>
                                v
                                    ? Gtk.Orientation.VERTICAL
                                    : Gtk.Orientation.HORIZONTAL
                            )}
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

                        <Gtk.Box
                            slot="end"
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
                );
            }}
        </For>
    );
};
