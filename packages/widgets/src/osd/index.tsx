import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import AudioController from '@shade/services/audio/audioController';
import Brightness from '@shade/services/display/brightness';
import Touchpad from '@shade/services/input/touchpad';
import WindowManager from '@shade/services/state/windowManager';
import {bind, computed} from 'gnim';
import PopupWindow from '../common/PopupWindow';
import Popup from './popup';
import Slider from './slider';
import TouchpadOsd from './touchpad';

const OSD_WIDTH = 250;
const OSD_MARGIN = 24;
const OSD_SPACING = 12;

export default () => {
    const audioCtrl = AudioController.get_default();
    const brightness = Brightness.get_default();
    const touchpad = Touchpad.get_default();

    // Real-time volume/mute/icon via AstalWp endpoint properties.
    // bind() with chained props uses computed({equals:()=>false}) internally,
    // so re-evaluates on every volume/mute/icon change on the endpoint.
    const speakerVol = bind(audioCtrl as any, 'defaultSpeaker', 'volume');
    const speakerIcon = bind(audioCtrl as any, 'defaultSpeaker', 'volumeIcon');
    const micVol = bind(audioCtrl as any, 'defaultMicrophone', 'volume');
    const micIcon = bind(audioCtrl as any, 'defaultMicrophone', 'volumeIcon');

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
                value: speakerVol,
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
                value: micVol,
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
            frame={false}
            ref={(self) => WindowManager.get_default().setOsd(self)}
        >
            <Gtk.Box
                cssClasses={['linked', 'card', 'background']}
                css={'box-shadow: none; padding: 12px; background-color: @window_bg_color;'}
                orientation={Gtk.Orientation.VERTICAL}
                valign={Gtk.Align.END}
                spacing={OSD_SPACING}
            >
                {popupList}
            </Gtk.Box>
        </PopupWindow>
    );
};
