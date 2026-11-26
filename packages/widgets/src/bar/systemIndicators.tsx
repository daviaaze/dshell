import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {IconNames} from '@shade/core/iconNames';
import AudioController from '@shade/services/audio/audioController';
import ShellState from '@shade/services/state/shellState';
import {type Accessor, bind} from 'gnim';
import {setAccessibleName} from '../common/iconButton';
import {MicrophoneIndicator, SpeakerIndicator} from './indicators/audio';
import BatteryIndicator from './indicators/battery';
import BluetoothIndicator from './indicators/bluetooth';
import DNDIndicator from './indicators/dnd';
import KeepAwakeIndicator from './indicators/keepAwake';
import NetworkIndicator from './indicators/network';
import PowerIndicator from './indicators/power';

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
        <Gtk.Box
            visible={visible}
            spacing={4}
            orientation={vertical.as((v) =>
                v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
            )}
        >
            <Gtk.ToggleButton
                cssClasses={vertical.as((v) =>
                    v ? ['flat', 'bar-vertical-content-button'] : ['flat']
                )}
                cursor={Gdk.Cursor.new_from_name('pointer', null)}
                active={bind(shellState, 'qsOpen')}
                onClicked={() => shellState.toggleQuickSettings()}
                tooltipText={'Controles rápidos\nRole para ajustar o volume'}
                ref={(self) => {
                    setAccessibleName('Controles rápidos', 'Role para ajustar o volume.')(self);
                    const scrollCtrl = new Gtk.EventControllerScroll({
                        flags: Gtk.EventControllerScrollFlags.VERTICAL,
                    });
                    scrollCtrl.connect('scroll', (_ctrl, _dx: number, dy: number) => {
                        audioCtrl.adjustVolume(dy > 0 ? -0.025 : 0.025);
                        return false;
                    });
                    self.add_controller(scrollCtrl);
                }}
            >
                <Gtk.Box
                    spacing={4}
                    orientation={vertical.as((v) =>
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
            <Gtk.ToggleButton
                cssClasses={vertical.as((v) =>
                    v ? ['flat', 'bar-vertical-content-button'] : ['flat']
                )}
                cursor={Gdk.Cursor.new_from_name('pointer', null)}
                active={bind(shellState, 'notificationsOpen')}
                onClicked={(self) => {
                    shellState.toggleNotifications();
                    self.active = shellState.notificationsOpen;
                }}
                tooltipText="Notificações"
                ref={setAccessibleName('Abrir central de notificações')}
            >
                <Gtk.Image iconName={IconNames.notifications} />
            </Gtk.ToggleButton>
        </Gtk.Box>
    );
};
