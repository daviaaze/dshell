import Wireplumber from 'gi://AstalWp';
import {createBinding, createComputed} from 'gnim';
import Brightness from '#/lib/services/display/brightness';
import Slider from './slider';
import TouchpadOsd from './touchpad';
import Touchpad from '#/lib/services/input/touchpad';
import AstalHyprland from 'gi://AstalHyprland';
import Popup from './popup';
import GObject from 'gnim/gobject';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {app} from '#/App';
import WindowManager from '#/lib/services/state/windowManager';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

export default () => {
    const brightness = Brightness.get_default();
    const audio = Wireplumber.get_default()!.audio;
    const hyprland = AstalHyprland.get_default();

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

    const popupList: GObject.Object[] = [
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
        <Astal.Window
            $={self => WindowManager.get_default().setOsd(self)}
            name={'osd'}
            widthRequest={250}
            application={app}
            margin={24}
            layer={Astal.Layer.OVERLAY}
            monitor={createBinding(hyprland, 'focusedMonitor').as(m => m.id)}
            cssClasses={[]}
            anchor={Astal.WindowAnchor.BOTTOM}
            visible={createComputed(
                (popupList as Gtk.Revealer[]).map(p =>
                    createBinding(p, 'revealChild')
                ),
                (...r: boolean[]) => r.reduce((a, b) => a || b)
            )}
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
        </Astal.Window>
    ) as Astal.Window;
};
