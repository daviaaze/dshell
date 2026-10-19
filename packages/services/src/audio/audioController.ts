import Wireplumber from 'gi://AstalWp';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';
import OsdTimer from '../utils/osdTimer';

/**
 * AudioController — semantic command layer over AstalWp.
 *
 * Widgets bind to reactive properties and call semantic methods;
 * they never access Wireplumber.Audio D-Bus proxy or call
 * Endpoint.set_volume() / .set_mute() directly.
 */
@register
export default class AudioController extends Object {
    private static instance: AudioController;

    static get_default(): AudioController {
        if (!AudioController.instance) AudioController.instance = new AudioController();
        return AudioController.instance;
    }

    #audio: Wireplumber.Audio | null = null;
    #initialized = false;
    #audioDefaultSpeakerSignalId = 0;
    #audioDefaultMicrophoneSignalId = 0;
    #speakerDefaultProxy: Wireplumber.Endpoint | null = null;
    #speakerDefaultProxySignalId = 0;
    #microphoneDefaultProxy: Wireplumber.Endpoint | null = null;
    #microphoneDefaultProxySignalId = 0;
    #audioSpeakersSignalId = 0;
    #audioMicrophonesSignalId = 0;
    #audioMicrophoneAddedSignalId = 0;
    #audioMicrophoneRemovedSignalId = 0;

    // ── OSD state (owned here so osd/bar/quicksettings share one source) ──

    #speakerOsd = new OsdTimer(() => this.notify('speaker-osd-visible'));
    #micOsd = new OsdTimer(() => this.notify('mic-osd-visible'));
    #speakerOsdConns: {obj: Wireplumber.Endpoint; id: number}[] = [];
    #micOsdConns: {obj: Wireplumber.Endpoint; id: number}[] = [];

    /** True while the speaker volume/mute OSD should be revealed. */
    @property
    get speakerOsdVisible(): boolean {
        return this.#speakerOsd.visible;
    }

    /** True while the microphone volume/mute OSD should be revealed. */
    @property
    get micOsdVisible(): boolean {
        return this.#micOsd.visible;
    }

    @property
    get audio(): Wireplumber.Audio | null {
        return this.#audio;
    }

    @property
    get defaultSpeaker(): Wireplumber.Endpoint | null {
        const audio = this.#audio;
        const endpoint = audio?.defaultSpeaker ?? null;
        if (!audio || !endpoint) return null;
        return audio.speakers?.find((speaker) => speaker.id === endpoint.id) ?? null;
    }

    @property
    get defaultMicrophone(): Wireplumber.Endpoint | null {
        const audio = this.#audio;
        const endpoint = audio?.defaultMicrophone ?? null;
        if (!audio || !endpoint) return null;
        return audio.microphones?.find((microphone) => microphone.id === endpoint.id) ?? null;
    }

    @property
    get speakers(): Wireplumber.Endpoint[] {
        return this.#audio?.speakers ?? [];
    }

    @property
    get microphones(): Wireplumber.Endpoint[] {
        return this.#audio?.microphones ?? [];
    }

    // ── Lifecycle ──

    #busSubscriptions: (() => void)[] = [];

    /** Initialize the Wireplumber D-Bus proxy. Call once during boot. */
    init() {
        if (this.#initialized) return;
        this.#initialized = true;

        // Subscribe to bus commands from widgets
        this.#busSubscriptions.push(
            bus.on('audio:set-volume', ({device, value}) =>
                this.setVolume(device as Wireplumber.Endpoint, value)
            )
        );
        this.#busSubscriptions.push(
            bus.on('audio:toggle-mute', ({device}) =>
                this.toggleMute(device as Wireplumber.Endpoint)
            )
        );

        try {
            this.#audio = Wireplumber.get_default()!.audio;
        } catch (e) {
            logger.error('audioController', 'Failed to init Wireplumber:', e);
            return;
        }

        // Forward property notifications so widgets can bind.
        // Emit initial notify so bindings pick up the current value
        // (AstalWp only fires notify on *change*, not on first read).
        this.#audioDefaultSpeakerSignalId = this.#audio.connect('notify::default-speaker', () => {
            this.#wireDefaultProxy('speaker');
            this.notify('default-speaker');
            this.#wireOsd('speaker');
        });
        this.#wireDefaultProxy('speaker');
        this.notify('default-speaker');
        this.#audioDefaultMicrophoneSignalId = this.#audio.connect('notify::default-microphone', () => {
            this.#wireDefaultProxy('mic');
            this.notify('default-microphone');
            this.#wireOsd('mic');
        });
        this.#wireDefaultProxy('mic');
        this.notify('default-microphone');
        this.#audioSpeakersSignalId = this.#audio.connect('notify::speakers', () => {
            this.notify('speakers');
            this.notify('default-speaker');
            this.#wireOsd('speaker');
        });
        this.#audioMicrophonesSignalId = this.#audio.connect('notify::microphones', () => {
            this.notify('microphones');
            this.notify('default-microphone');
            this.#wireOsd('mic');
        });
        const updateMicrophones = () => {
            this.notify('microphones');
            this.notify('default-microphone');
            this.#wireOsd('mic');
        };
        this.#audioMicrophoneAddedSignalId = this.#audio.connect('microphone-added', updateMicrophones);
        this.#audioMicrophoneRemovedSignalId = this.#audio.connect('microphone-removed', updateMicrophones);

        // OSD triggers on the current default devices
        this.#wireOsd('speaker');
        this.#wireOsd('mic');
    }

    /** Forward default endpoint identity changes from the mutable AstalWp proxy. */
    #wireDefaultProxy(kind: 'speaker' | 'mic') {
        const endpoint = kind === 'speaker'
            ? this.#audio?.defaultSpeaker ?? null
            : this.#audio?.defaultMicrophone ?? null;
        const previous = kind === 'speaker' ? this.#speakerDefaultProxy : this.#microphoneDefaultProxy;
        const previousSignalId = kind === 'speaker'
            ? this.#speakerDefaultProxySignalId
            : this.#microphoneDefaultProxySignalId;
        if (previous === endpoint) return;

        if (previous && previousSignalId) previous.disconnect(previousSignalId);

        if (kind === 'speaker') {
            this.#speakerDefaultProxy = endpoint;
            this.#speakerDefaultProxySignalId = 0;
        } else {
            this.#microphoneDefaultProxy = endpoint;
            this.#microphoneDefaultProxySignalId = 0;
        }
        if (!endpoint) return;

        const connectable = endpoint as unknown as {
            connect(signal: string, callback: () => void): number;
        };
        const signalId = connectable.connect('notify::id', () => {
            const property = kind === 'speaker' ? 'default-speaker' : 'default-microphone';
            this.notify(property);
            this.#wireOsd(kind);
        });
        if (kind === 'speaker') {
            this.#speakerDefaultProxySignalId = signalId;
        } else {
            this.#microphoneDefaultProxySignalId = signalId;
        }
    }

    /** (Re)subscribe OSD triggers only when the actual default endpoint changes. */
    #wireOsd(kind: 'speaker' | 'mic') {
        const conns = kind === 'speaker' ? this.#speakerOsdConns : this.#micOsdConns;
        const endpoint = kind === 'speaker' ? this.defaultSpeaker : this.defaultMicrophone;
        if ((conns[0]?.obj ?? null) === endpoint) return;

        for (const {obj, id} of conns) obj.disconnect(id);
        conns.length = 0;

        if (!endpoint) return;

        const osd = kind === 'speaker' ? this.#speakerOsd : this.#micOsd;
        const connectable = endpoint as unknown as {
            connect(signal: string, cb: () => void): number;
        };
        for (const signal of ['notify::volume', 'notify::mute']) {
            conns.push({obj: endpoint, id: connectable.connect(signal, () => osd.trigger())});
        }
    }


    dispose() {
        const audio = this.#audio;
        if (audio) {
            if (this.#audioDefaultSpeakerSignalId) audio.disconnect(this.#audioDefaultSpeakerSignalId);
            if (this.#audioDefaultMicrophoneSignalId) audio.disconnect(this.#audioDefaultMicrophoneSignalId);
            if (this.#audioSpeakersSignalId) audio.disconnect(this.#audioSpeakersSignalId);
            if (this.#audioMicrophonesSignalId) audio.disconnect(this.#audioMicrophonesSignalId);
            if (this.#audioMicrophoneAddedSignalId) audio.disconnect(this.#audioMicrophoneAddedSignalId);
            if (this.#audioMicrophoneRemovedSignalId) audio.disconnect(this.#audioMicrophoneRemovedSignalId);
        }
        this.#audioDefaultSpeakerSignalId = 0;
        this.#audioDefaultMicrophoneSignalId = 0;
        this.#audioSpeakersSignalId = 0;
        this.#audioMicrophonesSignalId = 0;
        this.#audioMicrophoneAddedSignalId = 0;
        this.#audioMicrophoneRemovedSignalId = 0;
        this.#audio = null;
        this.#wireDefaultProxy('speaker');
        this.#wireDefaultProxy('mic');
        this.#speakerOsd.dispose();
        this.#micOsd.dispose();
        for (const {obj, id} of [...this.#speakerOsdConns, ...this.#micOsdConns]) {
            obj.disconnect(id);
        }
        this.#speakerOsdConns = [];
        this.#micOsdConns = [];
        for (const unsub of this.#busSubscriptions) unsub();
        this.#busSubscriptions = [];
        this.#initialized = false;
    }

    // ── Semantic command methods ──

    /** Set volume on a device (0–1 range). */
    setVolume(device: Wireplumber.Endpoint, value: number) {
        device.set_volume(value);
    }

    /** Request a desired mute state; endpoint notifications remain authoritative. */
    setMute(device: Wireplumber.Endpoint, muted: boolean): void {
        device.set_mute(muted);
    }

    /** Toggle mute on a device. */
    toggleMute(device: Wireplumber.Endpoint) {
        this.setMute(device, !device.get_mute());
    }

    /** Set a device as the default. */
    setAsDefault(device: Wireplumber.Endpoint) {
        device.isDefault = true;
    }

    /**
     * Adjust default speaker volume by a delta (e.g. ±0.025 per scroll tick).
     * Clamps between 0 and 1.
     */
    adjustVolume(delta: number) {
        const speaker = this.defaultSpeaker;
        if (!speaker) return;
        const newVol = Math.max(0, Math.min(1, speaker.volume + delta));
        speaker.set_volume(newVol);
    }
}

defineService({name: 'AudioController', service: AudioController.get_default()});
