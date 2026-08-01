import {bind, computed} from 'gnim';
import Brightness from '@shade/services/display/brightness';
import Slider from './slider';
import TouchpadOsd from './touchpad';
import Touchpad from '@shade/services/input/touchpad';
import Gtk from 'gi://Gtk?version=4.0';
import Astal from 'gi://Astal?version=4.0';
import PopupWindow from '../common/PopupWindow';
import WindowManager from '@shade/services/state/windowManager';
import AudioController from '@shade/services/audio/audioController';
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

    const speakerIcon = computed(() =>
        audioCtrl.defaultSpeaker?.mute || audioCtrl.defaultSpeaker?.volume === 0
            ? MUTED_SPEAKER_ICON
            : (audioCtrl.defaultSpeaker?.volumeIcon ??
              'audio-volume-high-symbolic')
    );

    const micIcon = computed(() =>
        audioCtrl.defaultMicrophone?.mute ||
        audioCtrl.defaultMicrophone?.volume === 0
            ? MUTED_MIC_ICON
            : (audioCtrl.defaultMicrophone?.volumeIcon ??
              'audio-input-microphone-symbolic')
    );

    // Each OSD popup's reveal is owned by its domain service (AudioController,
    // Brightness, Touchpad) via an OsdTimer, so the popups stay pure UI.
    const speakerReveal = bind(audioCtrl, 'speakerOsdVisible');
    const screenReveal = bind(brightness, 'screenOsdVisible');
    const kbdReveal = bind(brightness, 'kbdOsdVisible');
    const micReveal = bind(audioCtrl, 'micOsdVisible');
    const touchpadReveal = bind(touchpad, 'osdVisible');

    const anyVisible = computed(
        () =>
            speakerReveal() ||
            screenReveal() ||
            kbdReveal() ||
            micReveal() ||
            touchpadReveal()
    );

    const popupList = [
        <Popup
            widget={Slider({
                iconName: speakerIcon,
                value: computed(() => audioCtrl.defaultSpeaker?.volume ?? 0),
            })}
            reveal={speakerReveal}
        />,
        <Popup
            widget={Slider({
                iconName: 'display-brightness-symbolic',
                value: bind(brightness, 'screen'),
            })}
            reveal={screenReveal}
        />,
        <Popup
            widget={Slider({
                iconName: 'keyboard-brightness-symbolic',
                value: computed(() => brightness.kbd),
            })}
            reveal={kbdReveal}
        />,
        <Popup
            widget={Slider({
                iconName: micIcon,
                value: computed(
                    () => audioCtrl.defaultMicrophone?.volume ?? 0
                ),
            })}
            reveal={micReveal}
        />,
        <Popup
            widget={<TouchpadOsd />}
            reveal={touchpadReveal}
        />,
    ];

    return (
        <PopupWindow
            name="osd"
            widthRequest={OSD_WIDTH}
            margin={OSD_MARGIN}
            anchor={Astal.WindowAnchor.BOTTOM}
            layer={Astal.Layer.OVERLAY}
            visible={anyVisible}
            ref={self => WindowManager.get_default().setOsd(self)}
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