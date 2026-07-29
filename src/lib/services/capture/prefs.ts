import AstalWp from 'gi://AstalWp?version=0.1';
import {Object, register} from 'gnim/gobject';
import {property} from '../../decorators';

/**
 * Recording preferences — audio toggle, input selection, quality, thumbnails.
 * Extracted from the Screenshot service; bind via `Screenshot.prefs`.
 */
@register
export default class RecordingPrefs extends Object {
    #audio = false;
    #selectedAudioInput = -1; // -1 = system default
    #selectedAudioInputName = 'System Default';
    #recordingQuality = 1; // 0=Low, 1=Medium, 2=High
    #previewThumbnails = true;

    @property
    get audio() {
        return this.#audio;
    }

    set audio(value: boolean) {
        if (this.#audio === value) return;
        this.#audio = value;
        this.notify('audio');
    }

    @property
    get selectedAudioInput() {
        return this.#selectedAudioInput;
    }

    set selectedAudioInput(value: number) {
        if (this.#selectedAudioInput === value) return;
        this.#selectedAudioInput = value;
        this.notify('selected-audio-input');
        // Update name for display
        if (value === -1) {
            this.#selectedAudioInputName = 'System Default';
        } else {
            const wp = AstalWp.get_default();
            const mic = wp?.audio.get_microphone(value);
            this.#selectedAudioInputName = mic?.description || `Input ${value}`;
        }
        this.notify('selected-audio-input-name');
    }

    @property
    get selectedAudioInputName() {
        return this.#selectedAudioInputName;
    }

    @property
    get recordingQuality() {
        return this.#recordingQuality;
    }

    set recordingQuality(value: number) {
        if (this.#recordingQuality === value) return;
        this.#recordingQuality = value;
        this.notify('recording-quality');
    }

    @property
    get previewThumbnails() {
        return this.#previewThumbnails;
    }

    set previewThumbnails(value: boolean) {
        if (this.#previewThumbnails === value) return;
        this.#previewThumbnails = value;
        this.notify('preview-thumbnails');
    }

    /** Snapshot for the recorder pipeline. */
    snapshot() {
        return {
            audio: this.#audio,
            input: this.#selectedAudioInput,
            quality: this.#recordingQuality,
        };
    }
}
