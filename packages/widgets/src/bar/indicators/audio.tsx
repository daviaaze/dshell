import Gtk from 'gi://Gtk?version=4.0';
import AudioController from '@shade/services/audio/audioController';
import AppMixer from '@shade/services/audio/mixer';
import {bind, computed} from 'gnim';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

function volumeTooltip(vol: number): string {
    return `${Math.round(vol * 100)}%`;
}

/**
 * Speaker icon — real-time volume/mute state from AstalWp (WirePlumber).
 * Uses bind(audioCtrl, 'defaultSpeaker', 'volume') / bind(endpoint, 'mute')
 * so the icon updates on every endpoint change, not just when the default
 * speaker changes.
 */
export const SpeakerIndicator = () => {
    const audioCtrl = AudioController.get_default();

    // Real-time volume and mute from the endpoint itself.
    // bind() with chained props uses computed({equals:()=>false}) internally,
    // so it re-evaluates on every notify: re-renders on every volume/mute change.
    // Use type assertions since the gnim type for chained bind is limited.
    const speakerVol = bind(audioCtrl as any, 'defaultSpeaker', 'volume');
    const speakerMute = bind(audioCtrl as any, 'defaultSpeaker', 'mute');
    const speakerIcon = bind(audioCtrl as any, 'defaultSpeaker', 'volumeIcon');

    const iconName = computed(() => {
        const vol = speakerVol() as number | undefined;
        const mute = speakerMute() as boolean | undefined;
        if (vol !== undefined && (mute || vol === 0)) return MUTED_SPEAKER_ICON;
        return (speakerIcon() as string | undefined) ?? MUTED_SPEAKER_ICON;
    });

    return (
        <Gtk.Image
            visible={bind(audioCtrl, 'speakers').as((s) => s.length > 0)}
            iconName={iconName}
            tooltipMarkup={computed(() => {
                const vol = speakerVol() as number | undefined;
                return vol !== undefined ? volumeTooltip(vol) : '';
            })}
            pixelSize={18}
        />
    );
};

/**
 * Microphone icon — real-time volume/mute state from AstalWp.
 */
export const MicrophoneIndicator = () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();

    const micVol = bind(audioCtrl as any, 'defaultMicrophone', 'volume');
    const micMute = bind(audioCtrl as any, 'defaultMicrophone', 'mute');
    const micIcon = bind(audioCtrl as any, 'defaultMicrophone', 'volumeIcon');

    const iconName = computed(() => {
        const vol = micVol() as number | undefined;
        const mute = micMute() as boolean | undefined;
        if (vol !== undefined && (mute || vol === 0)) return MUTED_MIC_ICON;
        return (micIcon() as string | undefined) ?? MUTED_MIC_ICON;
    });

    return (
        <Gtk.Image
            visible={bind(mixer, 'microphoneInUse')}
            iconName={iconName}
            tooltipMarkup={computed(() => {
                const vol = micVol() as number | undefined;
                return vol !== undefined ? volumeTooltip(vol) : '';
            })}
            pixelSize={18}
        />
    );
};
