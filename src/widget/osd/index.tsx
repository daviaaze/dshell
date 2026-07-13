import Wireplumber from 'gi://AstalWp';
import {createBinding, createComputed} from 'gnim';
import Brightness from '#/lib/services/display/brightness';
import Slider from './slider';
import TouchpadOsd from './touchpad';
import Touchpad from '#/lib/services/input/touchpad';
import GObject from 'gnim/gobject';
import Gtk from 'gi://Gtk?version=4.0';
import Astal from 'gi://Astal?version=4.0';
import PopupWindow from '#/widget/common/PopupWindow';
import WindowManager from '#/lib/services/state/windowManager';
import Popup from './popup';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

export default () => {
    const brightness = Brightness.get_default();
    const audio = Wireplumber.get_default()!.audio;

    const speakerIcon = createComputed(
        [
            createBinding(audio.defaultSpeaker, 'volume'),
            createBinding(audio.defaultSpeaker, 'mute'),
            createBinding(audio.defaultSpeaker, 'volumeIcon'),
        ],
        (volume, mute, volumeIcon) =>
            mute || volume === 0 ? MUTED_SPEAKER_ICON : volumeIcon
    );

    const micIcon = createComputed(
        [
            createBinding(audio.defaultMicrophone, 'volume'),
            createBinding(audio.defaultMicrophone, 'mute'),
            createBinding(audio.defaultMicrophone, 'volumeIcon'),
        ],
        (volume, mute, volumeIcon) =>
            mute || volume === 0 ? MUTED_MIC_ICON : volumeIcon
    );

    const popupList: Gtk.Revealer[] = [
        <Popup
            connectable={audio.defaultSpeaker}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: speakerIcon,
                value: createBinding(audio.defaultSpeaker, 'volume'),
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
            connectable={audio.defaultMicrophone}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: micIcon,
                value: createBinding(audio.defaultMicrophone, 'volume'),
            })}
        />,

        <Popup
            connectable={Touchpad.get_default()}
            signals={['toggled']}
            widget={<TouchpadOsd />}
        />,
    ];

    return (
        <PopupWindow
            name="osd"
            widthRequest={250}
            margin={24}
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
                spacing={12}
            >
                {popupList}
            </Gtk.Box>
        </PopupWindow>
    );
};