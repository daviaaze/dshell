import Gtk from 'gi://Gtk?version=4.0';
import AudioController from '@shade/services/audio/audioController';
import AppMixer from '@shade/services/audio/mixer';
import {bind, computed} from 'gnim';

type AppMixerLike = AppMixer & {
    'default-device-state': null;
    sinks: AppMixer['sinks'];
    sources: AppMixer['sources'];
};

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

function volumeTooltip(vol: number): string {
    return `${Math.round(vol * 100)}%`;
}

/**
 * Speaker icon — volume/mute state from AppMixer (pw-dump, accurate),
 * icon name from AudioController (AstalWp provides volumeIcon).
 */
export const SpeakerIndicator = () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();
    const speaker = bind(audioCtrl, 'defaultSpeaker');
    const speakerState = bind(mixer as AppMixerLike, 'default-device-state').as(() =>
        mixer.getDefaultDeviceState('speaker')
    );
    const speakerIcon = computed(() => speaker()?.volumeIcon ?? MUTED_SPEAKER_ICON);

    const resolveIcon = (state: {muted: boolean; volume: number} | null) =>
        state && (state.muted || state.volume === 0)
            ? MUTED_SPEAKER_ICON
            : (speakerIcon() ?? MUTED_SPEAKER_ICON);

    return (
        <Gtk.Image
            visible={bind(mixer, 'speakerInUse')}
            iconName={speakerState.as(resolveIcon)}
            tooltipMarkup={speakerState.as((state) => (state ? volumeTooltip(state.volume) : ''))}
            pixelSize={18}
        />
    );
};

/**
 * Microphone icon — volume/mute state from AppMixer (pw-dump, accurate),
 * icon name from AudioController (AstalWp provides volumeIcon).
 */
export const MicrophoneIndicator = () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();
    const mic = bind(audioCtrl, 'defaultMicrophone');
    const micState = bind(mixer as AppMixerLike, 'default-device-state').as(() =>
        mixer.getDefaultDeviceState('microphone')
    );
    const micIcon = computed(() => mic()?.volumeIcon ?? MUTED_MIC_ICON);

    const resolveIcon = (state: {muted: boolean; volume: number} | null) =>
        state && (state.muted || state.volume === 0)
            ? MUTED_MIC_ICON
            : (micIcon() ?? MUTED_MIC_ICON);

    return (
        <Gtk.Image
            visible={bind(mixer, 'microphoneInUse')}
            iconName={micState.as(resolveIcon)}
            tooltipMarkup={micState.as((state) => (state ? volumeTooltip(state.volume) : ''))}
            pixelSize={18}
        />
    );
};
