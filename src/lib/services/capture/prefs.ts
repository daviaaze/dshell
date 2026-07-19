import AstalWp from 'gi://AstalWp?version=0.1';
import GObject, {register} from 'gnim/gobject';
import {getter, setter} from '#/lib/decorators';

/**
 * Recording preferences — audio toggle, input selection, quality, thumbnails.
 * Extracted from the Screenshot service; bind via `Screenshot.prefs`.
 */
@register({GTypeName: 'RecordingPrefs'})
export default class RecordingPrefs extends GObject.Object {
    #audio = false;
    #selectedAudioInput = -1; // -1 = system default
    #selectedAudioInputName = 'System Default';
    #recordingQuality = 1; // 0=Low, 1=Medium, 2=High
    #previewThumbnails = true;

    @getter(Boolean)
    get audio() {
        return this.#audio;
    }

    @setter(Boolean)
    set audio(value: boolean) {
        if (this.#audio === value) return;
        this.#audio = value;
        this.notify('audio');
    }

    @getter(Number)
    get selectedAudioInput() {
        return this.#selectedAudioInput;
    }

    @setter(Number)
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

    @getter(String)
    get selectedAudioInputName() {
        return this.#selectedAudioInputName;
    }

    @getter(Number)
    get recordingQuality() {
        return this.#recordingQuality;
    }

    @setter(Number)
    set recordingQuality(value: number) {
        if (this.#recordingQuality === value) return;
        this.#recordingQuality = value;
        this.notify('recording-quality');
    }

    @getter(Boolean)
    get previewThumbnails() {
        return this.#previewThumbnails;
    }

    @setter(Boolean)
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
