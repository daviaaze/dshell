import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind} from 'gnim';
import ShellState from '#/lib/services/state/shellState';
import AudioController from '#/lib/services/audio/audioController';
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
    const shellState = ShellState.get_default();
    const audioCtrl = AudioController.get_default();
    return (
        <Gtk.ToggleButton
            visible={visible}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            active={bind(shellState, 'qsOpen')}
            onClicked={() => shellState.toggleQuickSettings()}
            ref={self =>
                self.add_controller(
                    (
                        <Gtk.EventControllerScroll
                            flags={Gtk.EventControllerScrollFlags.VERTICAL}
                            onScroll={(self, dx, dy) => {
                                audioCtrl.adjustVolume(dy > 0 ? -0.025 : 0.025);
                                return false;
                            }}
                        />
                    ) as any
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
