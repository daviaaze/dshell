import AstalWp from 'gi://AstalWp?version=0.1';
import {property} from '@shade/core/decorators';
import {Object, register} from 'gnim/gobject';
import {getScreenCaptureSettings} from '../settings/screenCapture';

/**
 * Recording preferences — audio toggle, input selection, quality, thumbnails.
 * Backed by the `screen-capture` GSettings schema so the Settings page,
 * the capture overlay and the recorder pipeline all share one source of
 * truth.
 */
@register
export default class RecordingPrefs extends Object {
    #selectedAudioInputName = 'System Default';

    /** GSettings group (lazy: resolved on first use, after boot). */
    #settings() {
        return getScreenCaptureSettings();
    }

    @property
    get audio() {
        return this.#settings().recordAudio();
    }

    set audio(value: boolean) {
        if (this.audio === value) return;
        this.#settings().setRecordAudio(value);
        this.notify('audio');
    }

    @property
    get selectedAudioInput() {
        return this.#settings().audioInputId();
    }

    set selectedAudioInput(value: number) {
        if (this.selectedAudioInput === value) return;
        this.#settings().setAudioInputId(value);
        // Update name for display
        if (value === -1) {
            this.#selectedAudioInputName = 'System Default';
        } else {
            const wp = AstalWp.get_default();
            const mic = wp?.audio.get_microphone(value);
            this.#selectedAudioInputName = mic?.description || `Input ${value}`;
        }
        this.notify('selected-audio-input');
        this.notify('selected-audio-input-name');
    }

    @property
    get selectedAudioInputName() {
        return this.#selectedAudioInputName;
    }

    @property
    get recordingQuality() {
        return this.#settings().recordingQuality();
    }

    set recordingQuality(value: number) {
        if (this.recordingQuality === value) return;
        this.#settings().setRecordingQuality(value);
        this.notify('recording-quality');
    }

    @property
    get previewThumbnails() {
        return this.#settings().previewThumbnailsEnabled();
    }

    set previewThumbnails(value: boolean) {
        if (this.previewThumbnails === value) return;
        this.#settings().setPreviewThumbnailsEnabled(value);
        this.notify('preview-thumbnails');
    }

    /** Snapshot for the recorder pipeline. */
    snapshot() {
        return {
            audio: this.audio,
            input: this.selectedAudioInput,
            quality: this.recordingQuality,
        };
    }
}