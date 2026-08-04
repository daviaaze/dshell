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
        return this.#audio?.defaultSpeaker ?? null;
    }

    @property
    get defaultMicrophone(): Wireplumber.Endpoint | null {
        return this.#audio?.defaultMicrophone ?? null;
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
        this.#audio.connect('notify::default-speaker', () => {
            this.notify('default-speaker');
            this.#wireOsd('speaker');
        });
        this.notify('default-speaker');
        this.#audio.connect('notify::default-microphone', () => {
            this.notify('default-microphone');
            this.#wireOsd('mic');
        });
        this.notify('default-microphone');
        this.#audio.connect('notify::speakers', () => {
            this.notify('speakers');
        });
        this.#audio.connect('notify::microphones', () => {
            this.notify('microphones');
        });
        this.#audio.connect('microphone-added', () => {
            this.notify('microphones');
        });
        this.#audio.connect('microphone-removed', () => {
            this.notify('microphones');
        });

        // OSD triggers on the current default devices
        this.#wireOsd('speaker');
        this.#wireOsd('mic');
    }

    /** (Re)subscribe OSD triggers to the current default endpoint. */
    #wireOsd(kind: 'speaker' | 'mic') {
        const conns = kind === 'speaker' ? this.#speakerOsdConns : this.#micOsdConns;
        for (const {obj, id} of conns) obj.disconnect(id);
        conns.length = 0;

        const endpoint = kind === 'speaker' ? this.defaultSpeaker : this.defaultMicrophone;
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

    /** Toggle mute on a device. */
    toggleMute(device: Wireplumber.Endpoint) {
        device.set_mute(!device.get_mute());
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
