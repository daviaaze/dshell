import Wireplumber from 'gi://AstalWp';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createState, onMount, onCleanup} from 'gnim';
import AppMixer from '#/lib/appMixer';
import {connectFor, cleanupNode} from '#/lib/connectFor';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

function volumeIcon(device: Wireplumber.Endpoint, mutedIcon: string): string {
    if (device.mute || device.volume === 0) return mutedIcon;
    return device.volumeIcon;
}

function volumeTooltip(vol: number): string {
    return `${Math.round(vol * 100)}%`;
}

export const SpeakerIndicator = () => {
    const [visible, setVisible] = createState(false);
    const [iconName, setIconName] = createState(MUTED_SPEAKER_ICON);
    const [tooltip, setTooltip] = createState('');

    onMount(() => {
        const _hn = {};
        // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const audio = Wireplumber.get_default()!.audio;
            const mixer = AppMixer.get_default();
            const update = () => {
                setVisible(mixer.speaker_in_use);
                const speaker = audio.default_speaker;
                setIconName(volumeIcon(speaker, MUTED_SPEAKER_ICON));
                setTooltip(volumeTooltip(speaker.volume));
            };
            update();
            connectFor(_hn, mixer, 'notify::speaker-in-use', update);
            connectFor(_hn, audio.default_speaker, 'notify::volume', update);
            connectFor(_hn, audio.default_speaker, 'notify::mute', update);
            connectFor(
                _hn,
                audio.default_speaker,
                'notify::volumeIcon',
                update
            );
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Image
            visible={visible}
            iconName={iconName}
            tooltipMarkup={tooltip}
            pixelSize={18}
        />
    );
};

export const MicrophoneIndicator = () => {
    const [visible, setVisible] = createState(false);
    const [iconName, setIconName] = createState(MUTED_MIC_ICON);
    const [tooltip, setTooltip] = createState('');

    onMount(() => {
        const _hn = {};
        // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const audio = Wireplumber.get_default()!.audio;
            const mixer = AppMixer.get_default();
            const update = () => {
                setVisible(mixer.microphone_in_use);
                const mic = audio.default_microphone;
                setIconName(volumeIcon(mic, MUTED_MIC_ICON));
                setTooltip(volumeTooltip(mic.volume));
            };
            update();
            connectFor(_hn, mixer, 'notify::microphone-in-use', update);
            connectFor(_hn, audio.default_microphone, 'notify::volume', update);
            connectFor(_hn, audio.default_microphone, 'notify::mute', update);
            connectFor(
                _hn,
                audio.default_microphone,
                'notify::volumeIcon',
                update
            );
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Image
            visible={visible}
            iconName={iconName}
            tooltipMarkup={tooltip}
            pixelSize={18}
        />
    );
};
