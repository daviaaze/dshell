import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import AudioController from '@shade/services/audio/audioController';
import AppMixer from '@shade/services/audio/mixer';
import Brightness from '@shade/services/display/brightness';
import Touchpad from '@shade/services/input/touchpad';
import WindowManager from '@shade/services/state/windowManager';
import {bind, computed} from 'gnim';
import PopupWindow from '../common/PopupWindow';
import Popup from './popup';
import Slider from './slider';
import TouchpadOsd from './touchpad';

type AppMixerLike = AppMixer & {
    'default-device-state': null;
};

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';
const DEFAULT_SPEAKER_ICON = 'audio-volume-high-symbolic';
const DEFAULT_MIC_ICON = 'audio-input-microphone-symbolic';
const OSD_WIDTH = 250;
const OSD_MARGIN = 24;
const OSD_SPACING = 12;

export default () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();
    const brightness = Brightness.get_default();
    const touchpad = Touchpad.get_default();

    // Volume/mute state from AppMixer (pw-dump, accurate) — AstalWp
    // (audioCtrl.defaultSpeaker) reports stale volume/mute values.
    const speakerState = bind(mixer as AppMixerLike, 'default-device-state').as(() =>
        mixer.getDefaultDeviceState('speaker')
    );
    const micState = bind(mixer as AppMixerLike, 'default-device-state').as(() =>
        mixer.getDefaultDeviceState('microphone')
    );

    const speakerIcon = computed(() => {
        const state = speakerState();
        if (state && (state.muted || state.volume === 0)) return MUTED_SPEAKER_ICON;
        return audioCtrl.defaultSpeaker?.volumeIcon ?? DEFAULT_SPEAKER_ICON;
    });

    const micIcon = computed(() => {
        const state = micState();
        if (state && (state.muted || state.volume === 0)) return MUTED_MIC_ICON;
        return audioCtrl.defaultMicrophone?.volumeIcon ?? DEFAULT_MIC_ICON;
    });

    // Each OSD popup's reveal is owned by its domain service (AudioController,
    // Brightness, Touchpad) via an OsdTimer, so the popups stay pure UI.
    const speakerReveal = bind(audioCtrl, 'speakerOsdVisible');
    const screenReveal = bind(brightness, 'screenOsdVisible');
    const kbdReveal = bind(brightness, 'kbdOsdVisible');
    const micReveal = bind(audioCtrl, 'micOsdVisible');
    const touchpadReveal = bind(touchpad, 'osdVisible');

    const anyVisible = computed(
        () => speakerReveal() || screenReveal() || kbdReveal() || micReveal() || touchpadReveal()
    );

    const popupList = [
        <Popup
            widget={Slider({
                iconName: speakerIcon,
                value: computed(() => speakerState()?.volume ?? 0),
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
                value: computed(() => micState()?.volume ?? 0),
            })}
            reveal={micReveal}
        />,
        <Popup widget={<TouchpadOsd />} reveal={touchpadReveal} />,
    ];

    return (
        <PopupWindow
            name="osd"
            widthRequest={OSD_WIDTH}
            margin={OSD_MARGIN}
            anchor={Astal.WindowAnchor.BOTTOM}
            layer={Astal.Layer.OVERLAY}
            visible={anyVisible}
            ref={(self) => WindowManager.get_default().setOsd(self)}
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
