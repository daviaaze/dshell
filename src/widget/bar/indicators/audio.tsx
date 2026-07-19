import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import AudioController from '#/lib/services/audio/audioController';
import AppMixer from '#/lib/services/audio/mixer';

const MUTED_SPEAKER_ICON = 'audio-volume-muted-symbolic';
const MUTED_MIC_ICON = 'microphone-sensitivity-muted-symbolic';

function volumeTooltip(vol: number): string {
    return `${Math.round(vol * 100)}%`;
}

export const SpeakerIndicator = () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();
    const speaker = createBinding(audioCtrl, 'default-speaker');

    return (
        <Gtk.Image
            visible={createBinding(mixer, 'speaker-in-use')}
            iconName={speaker.as(s => {
                if (!s || s.mute || s.volume === 0) return MUTED_SPEAKER_ICON;
                return s.volumeIcon;
            })}
            tooltipMarkup={speaker.as(s =>
                s ? volumeTooltip(s.volume) : ''
            )}
            pixelSize={18}
        />
    );
};

export const MicrophoneIndicator = () => {
    const audioCtrl = AudioController.get_default();
    const mixer = AppMixer.get_default();
    const mic = createBinding(audioCtrl, 'default-microphone');

    return (
        <Gtk.Image
            visible={createBinding(mixer, 'microphone-in-use')}
            iconName={mic.as(m => {
                if (!m || m.mute || m.volume === 0) return MUTED_MIC_ICON;
                return m.volumeIcon;
            })}
            tooltipMarkup={mic.as(m =>
                m ? volumeTooltip(m.volume) : ''
            )}
            pixelSize={18}
        />
    );
};