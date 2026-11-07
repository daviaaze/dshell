import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {getApp} from '@shade/services/appHandle';
import AudioController from '@shade/services/audio/audioController';
import {getVolumeIcon} from '@shade/services/audio/icons';
import Brightness from '@shade/services/display/brightness';
import {getHyprland} from '@shade/services/hyprland';
import Touchpad from '@shade/services/input/touchpad';
import WindowManager from '@shade/services/state/windowManager';
import {monitorIndexFromHyprland} from '@shade/services/utils/monitors';
import {bind, computed, onCleanup, With} from 'gnim';
import Popup from './popup';
import Slider from './slider';
import TouchpadOsd from './touchpad';

export default () => {
    const hyprland = getHyprland();
    if (!hyprland) return null;
    const audio = AudioController.get_default();
    const brightness = Brightness.get_default();
    const touchpad = Touchpad.get_default();
    const speaker = bind(audio, 'defaultSpeaker');
    const microphone = bind(audio, 'defaultMicrophone');
    const speakerReveal = bind(audio, 'speakerOsdVisible');
    const micReveal = bind(audio, 'micOsdVisible');
    const screenReveal = bind(brightness, 'screenOsdVisible');
    const keyboardReveal = bind(brightness, 'kbdOsdVisible');
    const touchpadReveal = bind(touchpad, 'osdVisible');
    const screen = bind(brightness, 'screen');
    const keyboard = bind(brightness, 'kbd');
    const visible = computed(
        () =>
            (speakerReveal() && speaker() !== null) ||
            (micReveal() && microphone() !== null) ||
            (screenReveal() && screen() >= 0) ||
            (keyboardReveal() && keyboard() >= 0) ||
            touchpadReveal()
    );
    return (
        <Astal.Window
            name="osd"
            namespace="shade-osd"
            application={getApp()}
            visible={visible}
            keymode={Astal.Keymode.NONE}
            layer={Astal.Layer.OVERLAY}
            anchor={Astal.WindowAnchor.BOTTOM}
            margin={24}
            widthRequest={250}
            cssClasses={[]}
            css="background-color: transparent;"
            monitor={bind(hyprland, 'focused-monitor').as(monitorIndexFromHyprland)}
            ref={(self) => {
                const manager = WindowManager.get_default();
                manager.setOsd(self);
                onCleanup(() => {
                    if (manager.osd === self) manager.setOsd(null);
                });
            }}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['card', 'background', 'vertical']}
                spacing={8}
                css="padding: 8px;"
            >
                <With value={speaker}>
                    {(device) =>
                        device ? (
                            <Popup
                                widget={Slider({
                                    iconName: getVolumeIcon(device, 'audio-volume-muted-symbolic'),
                                    value: bind(device, 'volume'),
                                })}
                                reveal={speakerReveal}
                            />
                        ) : null
                    }
                </With>
                <Popup
                    widget={Slider({iconName: 'display-brightness-symbolic', value: screen})}
                    reveal={computed(() => screenReveal() && screen() >= 0)}
                />
                <Popup
                    widget={Slider({iconName: 'keyboard-brightness-symbolic', value: keyboard})}
                    reveal={computed(() => keyboardReveal() && keyboard() >= 0)}
                />
                <With value={microphone}>
                    {(device) =>
                        device ? (
                            <Popup
                                widget={Slider({
                                    iconName: getVolumeIcon(
                                        device,
                                        'microphone-sensitivity-muted-symbolic'
                                    ),
                                    value: bind(device, 'volume'),
                                })}
                                reveal={micReveal}
                            />
                        ) : null
                    }
                </With>
                <Popup widget={<TouchpadOsd />} reveal={touchpadReveal} />
            </Gtk.Box>
        </Astal.Window>
    );
};
