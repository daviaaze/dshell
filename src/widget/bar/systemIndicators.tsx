import Wireplumber from 'gi://AstalWp';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {Accessor, createBinding, createState, onMount} from 'gnim';
import ShellState from '#/lib/shellState';
import KeepAwakeIndicator from './indicators/keepAwake';
import PowerIndicator from './indicators/power';
import BluetoothIndicator from './indicators/bluetooth';
import NetworkIndicator from './indicators/network';
import BatteryIndicator from './indicators/battery';
import {SpeakerIndicator, MicrophoneIndicator} from './indicators/audio';
import DNDIndicator from './indicators/dnd';

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const [audio, setAudio] = createState<Wireplumber.Audio | null>(null);

    onMount(() => {
        // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            setAudio(Wireplumber.get_default()!.audio);
            return GLib.SOURCE_REMOVE;
        });
    });

    return (
        <Gtk.ToggleButton
            visible={visible}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            active={createBinding(ShellState.get_default(), 'qsOpen')}
            onClicked={() => ShellState.get_default().toggleQuickSettings()}
            $={self =>
                self.add_controller(
                    (
                        <Gtk.EventControllerScroll
                            flags={Gtk.EventControllerScrollFlags.VERTICAL}
                            onScroll={(self, dx, dy) => {
                                const a = audio();
                                if (!a) return;
                                if (dy > 0) a.default_speaker.volume -= 0.025;
                                else a.default_speaker.volume += 0.025;
                            }}
                        />
                    ) as Gtk.EventController
                )
            }
        >
            <Gtk.Box
                spacing={4}
                orientation={vertical.as(v =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <KeepAwakeIndicator />
                <PowerIndicator />
                <BluetoothIndicator />
                <NetworkIndicator />
                <BatteryIndicator />
                <MicrophoneIndicator />
                <SpeakerIndicator />
                <DNDIndicator />
            </Gtk.Box>
        </Gtk.ToggleButton>
    );
};
