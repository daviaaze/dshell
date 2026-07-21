import {createBinding, createComputed} from 'gnim';
import Brightness from '#/lib/services/display/brightness';
import Slider from './slider';
import TouchpadOsd from './touchpad';
import Touchpad from '#/lib/services/input/touchpad';
import Gtk from 'gi://Gtk?version=4.0';
import Astal from 'gi://Astal?version=4.0';
import PopupWindow from '#/widget/common/PopupWindow';
import WindowManager from '#/lib/services/state/windowManager';
import AudioController from '#/lib/services/audio/audioController';
import Popup from './popup';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';
const OSD_WIDTH = 250;
const OSD_MARGIN = 24;
const OSD_SPACING = 12;

export default () => {
    const audioCtrl = AudioController.get_default();
    const brightness = Brightness.get_default();
    const touchpad = Touchpad.get_default();

    const speakerIcon = createComputed(
        () =>
            audioCtrl.defaultSpeaker?.mute || audioCtrl.defaultSpeaker?.volume === 0
                ? MUTED_SPEAKER_ICON
                : audioCtrl.defaultSpeaker?.volumeIcon ?? 'audio-volume-high-symbolic'
    );

    const micIcon = createComputed(
        () =>
            audioCtrl.defaultMicrophone?.mute || audioCtrl.defaultMicrophone?.volume === 0
                ? MUTED_MIC_ICON
                : audioCtrl.defaultMicrophone?.volumeIcon ?? 'audio-input-microphone-symbolic'
    );

    const popupList: Gtk.Revealer[] = [
        <Popup
            connectable={audioCtrl.defaultSpeaker}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: speakerIcon,
                value: createComputed(() => audioCtrl.defaultSpeaker?.volume ?? 0),
            })}
        /> as Gtk.Revealer,
        <Popup
            connectable={brightness}
            signals={['notify::screen']}
            widget={Slider({
                iconName: 'display-brightness-symbolic',
                value: createBinding(brightness, 'screen'),
            })}
        /> as Gtk.Revealer,
        <Popup
            connectable={brightness}
            signals={['notify::kbd']}
            widget={Slider({
                iconName: 'keyboard-brightness-symbolic',
                value: createComputed(() => brightness.kbd),
            })}
        /> as Gtk.Revealer,
        <Popup
            connectable={audioCtrl.defaultMicrophone}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: micIcon,
                value: createComputed(() => audioCtrl.defaultMicrophone?.volume ?? 0),
            })}
        /> as Gtk.Revealer,
        <Popup
            connectable={touchpad}
            signals={['toggled']}
            widget={<TouchpadOsd />}
        /> as Gtk.Revealer,
    ];

    return (
        <PopupWindow
            name="osd"
            widthRequest={OSD_WIDTH}
            margin={OSD_MARGIN}
            anchor={Astal.WindowAnchor.BOTTOM}
            layer={Astal.Layer.OVERLAY}
            visible={createComputed(
                () => (popupList).map(p =>
                    p.revealChild).reduce((a, b) => a || b)
            )}
            $={self => WindowManager.get_default().setOsd(self)}
        >
            <Gtk.Box
                cssClasses={['linked', 'card', 'background']}
                css={'box-shadow: none; padding: 12px;'}
                orientation={Gtk.Orientation.VERTICAL}
                valign={Gtk.Align.END}
                spacing={OSD_SPACING}
            >
                {popupList}
            </Gtk.Box>
        </PopupWindow>
    );
};
