// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
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
        [
            createBinding(audioCtrl.defaultSpeaker, 'volume'),
            createBinding(audioCtrl.defaultSpeaker, 'mute'),
            createBinding(audioCtrl.defaultSpeaker, 'volumeIcon'),
        ],
        (volume, mute, volumeIcon) =>
            mute || volume === 0 ? MUTED_SPEAKER_ICON : volumeIcon
    );

    const micIcon = createComputed(
        [
            createBinding(audioCtrl.defaultMicrophone, 'volume'),
            createBinding(audioCtrl.defaultMicrophone, 'mute'),
            createBinding(audioCtrl.defaultMicrophone, 'volumeIcon'),
        ],
        (volume, mute, volumeIcon) =>
            mute || volume === 0 ? MUTED_MIC_ICON : volumeIcon
    );

    const popupList: Gtk.Revealer[] = [
        <Popup
            connectable={audioCtrl.defaultSpeaker}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: speakerIcon,
                value: createBinding(audioCtrl.defaultSpeaker, 'volume'),
            })}
        />,

        <Popup
            connectable={brightness}
            signals={['notify::screen']}
            widget={Slider({
                iconName: 'display-brightness-symbolic',
                value: createBinding(brightness, 'screen'),
            })}
        />,

        <Popup
            connectable={brightness}
            signals={['notify::kbd']}
            widget={Slider({
                iconName: 'keyboard-brightness-symbolic',
                value: createBinding(brightness, 'kbd'),
            })}
        />,

        <Popup
            connectable={audioCtrl.defaultMicrophone}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: micIcon,
                value: createBinding(audioCtrl.defaultMicrophone, 'volume'),
            })}
        />,

        <Popup
            connectable={touchpad}
            signals={['toggled']}
            widget={<TouchpadOsd />}
        />,
    ];

    return (
        <PopupWindow
            name="osd"
            widthRequest={OSD_WIDTH}
            margin={OSD_MARGIN}
            anchor={Astal.WindowAnchor.BOTTOM}
            layer={Astal.Layer.OVERLAY}
            visible={createComputed(
                (popupList as Gtk.Revealer[]).map(p =>
                    createBinding(p, 'revealChild')
                ),
                (...r: boolean[]) => r.reduce((a, b) => a || b)
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