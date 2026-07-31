import {bind, computed, createState} from 'gnim';
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
const REVEAL_SIGNAL = 'notify::reveal-child';
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

    const [v0, s0] = createState(false);
    const [v1, s1] = createState(false);
    const [v2, s2] = createState(false);
    const [v3, s3] = createState(false);
    const [v4, s4] = createState(false);

    const anyVisible = computed(() => v0() || v1() || v2() || v3() || v4());

    const popupList = [
        <Popup
            connectable={audioCtrl.defaultSpeaker}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: speakerIcon,
                value: computed(
                    () => audioCtrl.defaultSpeaker?.volume ?? 0
                ),
            })}
            revealerRef={r =>
                r.connect(REVEAL_SIGNAL, () => s0(r.revealChild))
            }
        />,
        <Popup
            connectable={brightness}
            signals={['notify::screen']}
            widget={Slider({
                iconName: 'display-brightness-symbolic',
                value: bind(brightness, 'screen'),
            })}
            revealerRef={r =>
                r.connect(REVEAL_SIGNAL, () => s1(r.revealChild))
            }
        />,
        <Popup
            connectable={brightness}
            signals={['notify::kbd']}
            widget={Slider({
                iconName: 'keyboard-brightness-symbolic',
                value: computed(() => brightness.kbd),
            })}
            revealerRef={r =>
                r.connect(REVEAL_SIGNAL, () => s2(r.revealChild))
            }
        />,
        <Popup
            connectable={audioCtrl.defaultMicrophone}
            signals={['notify::volume', 'notify::mute']}
            widget={Slider({
                iconName: micIcon,
                value: computed(
                    () => audioCtrl.defaultMicrophone?.volume ?? 0
                ),
            })}
            revealerRef={r =>
                r.connect(REVEAL_SIGNAL, () => s3(r.revealChild))
            }
        />,
        <Popup
            connectable={touchpad}
            signals={['toggled']}
            widget={<TouchpadOsd />}
            revealerRef={r =>
                r.connect(REVEAL_SIGNAL, () => s4(r.revealChild))
            }
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
