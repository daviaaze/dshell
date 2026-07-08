import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Wireplumber from 'gi://AstalWp';
import {createState, onMount, onCleanup} from 'gnim';
import Screenshot from '#/lib/screenshot';
import {connectFor, cleanupNode} from '#/lib/connectFor';

export default () => {
    const ss = Screenshot.get_default();
    const [audio, setAudio] = createState<Wireplumber.Audio | null>(null);

    onMount(() => {
        const _hn = {};
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const wp = Wireplumber.get_default();
            if (wp) {
                setAudio(wp.audio);
            }
            return GLib.SOURCE_REMOVE;
        });
        onCleanup(() => cleanupNode(_hn));
    });

    return (
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName="audio-input-microphone-symbolic"
                pixelSize={16}
            />
            <Gtk.DropDown
                $={self => {
                    const _hn = {};

                    // Build a StringList model from microphones
                    const updateModel = () => {
                        const a = audio();
                        const mics = a?.microphones || [];
                        const strings = [
                            'System Default',
                            ...mics.map(
                                mic =>
                                    mic.description ||
                                    mic.name ||
                                    `Input ${mic.id}`
                            ),
                        ];
                        const list = Gtk.StringList.new(strings);
                        self.set_model(list);
                        // Set selection from screenshot state
                        const currentId = ss.selectedAudioInput;
                        if (currentId === -1) {
                            self.set_selected(0);
                        } else {
                            const idx = mics.findIndex(m => m.id === currentId);
                            self.set_selected(idx >= 0 ? idx + 1 : 0);
                        }
                    };

                    updateModel();

                    // Listen for microphone changes
                    const a = audio();
                    if (a) {
                        connectFor(
                            _hn,
                            a,
                            'microphone-added',
                            updateModel
                        );
                        connectFor(
                            _hn,
                            a,
                            'microphone-removed',
                            updateModel
                        );
                    }

                    // Listen for selection changes
                    self.connect('notify::selected', () => {
                        const idx = self.selected;
                        if (idx <= 0) {
                            ss.selectedAudioInput = -1;
                        } else {
                            const a = audio();
                            const mics = a?.microphones || [];
                            const mic = mics[idx - 1];
                            if (mic) {
                                ss.selectedAudioInput = mic.id;
                            }
                        }
                    });
                }}
            />
        </Gtk.Box>
    );
};
