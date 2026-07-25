import {Object, register, property} from 'gnim/gobject';
import Wireplumber from 'gi://AstalWp';
import logger from '#/lib/core/logger';

/**
 * AudioController — semantic command layer over AstalWp.
 *
 * Widgets bind to reactive properties and call semantic methods;
 * they never access Wireplumber.Audio D-Bus proxy or call
 * Endpoint.set_volume() / .set_mute() directly.
 */
@register({GTypeName: 'AudioController'})
export default class AudioController extends Object {
    static instance: AudioController;

    static get_default(): AudioController {
        if (!this.instance) this.instance = new AudioController();
        return this.instance;
    }

    #audio: Wireplumber.Audio | null = null;
    #initialized = false;

    @property(Object)

    @property(Object)

    @property(Object)

    @property(Object)

    @property(Object)

    // ── Lifecycle ──

    /** Initialize the Wireplumber D-Bus proxy. Call once during boot. */
    init() {
        if (this.#initialized) return;
        this.#initialized = true;

        try {
            this.#audio = Wireplumber.get_default()!.audio;
        } catch (e) {
            logger.error('audioController', 'Failed to init Wireplumber:', e);
            return;
        }

        // Forward property notifications so widgets can bind
        this.#audio.connect('notify::default-speaker', () => {
            this.notify('default-speaker');
        });
        this.#audio.connect('notify::default-microphone', () => {
            this.notify('default-microphone');
        });
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
