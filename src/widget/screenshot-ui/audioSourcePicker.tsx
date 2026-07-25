import Gtk from 'gi://Gtk?version=4.0';
import {bind} from 'gnim';
import AudioController from '#/lib/services/audio/audioController';
import Screenshot from '#/lib/services/capture/screenshot';

const AUDIO_PICKER_SPACING = 8;
const AUDIO_ICON_SIZE = 16;
const SYSTEM_DEFAULT_ID = -1;

export default () => {
    const ss = Screenshot.get_default();
    const audioCtrl = AudioController.get_default();
    const mics = bind(audioCtrl, 'microphones');

    return (
        <Gtk.Box spacing={AUDIO_PICKER_SPACING} valign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName="audio-input-microphone-symbolic"
                pixelSize={AUDIO_ICON_SIZE}
            />
            <Gtk.DropDown
                ref={self => {
                    const updateModel = () => {
                        const list = mics();
                        const strings = [
                            'System Default',
                            ...list.map(
                                mic =>
                                    mic.description ||
                                    mic.name ||
                                    `Input ${mic.id}`
                            ),
                        ];
                        self.set_model(Gtk.StringList.new(strings));

                        const currentId = ss.prefs.selectedAudioInput;
                        if (currentId === SYSTEM_DEFAULT_ID) {
                            self.set_selected(0);
                        } else {
                            const idx = list.findIndex(m => m.id === currentId);
                            self.set_selected(idx >= 0 ? idx + 1 : 0);
                        }
                    };

                    updateModel();

                    // Rebuild model when microphone list changes
                    mics.subscribe(updateModel);

                    // Listen for selection changes
                    self.connect('notify::selected', () => {
                        const idx = self.selected;
                        if (idx <= 0) {
                            ss.prefs.selectedAudioInput = -1;
                        } else {
                            const list = mics();
                            const mic = list[idx - 1];
                            if (mic) {
                                ss.prefs.selectedAudioInput = mic.id;
                            }
                        }
                    });
                }}
            />
        </Gtk.Box>
    );
};
