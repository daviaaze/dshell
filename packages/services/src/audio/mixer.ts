import Wireplumber from 'gi://AstalWp';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register} from 'gnim/gobject';

import {bus} from '../bus';

export interface AudioStream {
    id: number;
    name: string;
    appName: string;
    iconName: string;
    volume: number;
    muted: boolean;
    targetNode: number | null;
}

// ── AstalWp stream → AudioStream ──

function streamFromAstal(s: Wireplumber.Stream): AudioStream {
    const appName = s.get_pw_property('application.name') || s.description || s.name || 'Unknown';
    const iconName =
        s.get_pw_property('application.icon-name') || s.icon || 'audio-x-generic-symbolic';
    return {
        id: s.id,
        name: s.description || s.name || 'Unknown',
        appName,
        iconName,
        volume: s.volume,
        muted: s.mute,
        targetNode: s.targetEndpoint?.id ?? null,
    };
}

function isOutputStream(mediaClass: Wireplumber.MediaClass): boolean {
    return (
        mediaClass === Wireplumber.MediaClass.STREAM_OUTPUT_AUDIO ||
        mediaClass === Wireplumber.MediaClass.STREAM_OUTPUT_VIDEO
    );
}

function isInputStream(mediaClass: Wireplumber.MediaClass): boolean {
    return (
        mediaClass === Wireplumber.MediaClass.STREAM_INPUT_AUDIO ||
        mediaClass === Wireplumber.MediaClass.STREAM_INPUT_VIDEO
    );
}

@register
export default class AppMixer extends Object {
    private static instance: AppMixer;
    static get_default() {
        if (!AppMixer.instance) {
            AppMixer.instance = new AppMixer();
            AppMixer.instance.#initBus();
        }
        return AppMixer.instance;
    }

    #initBus(): void {
        if (this.#busInitialized) return;
        this.#busInitialized = true;
        bus.on('audio:app-mixer:set-volume', ({id, value}) => this.setVolume(id, value));
    }

    #streams: AudioStream[] = [];
    #captureStreams: AudioStream[] = [];
    #busInitialized = false;
    static readonly MODIFY_GRACE_MS = 3000;
    #lastModified = new Map<number, number>();

    // Signal handler IDs for cleanup
    #streamAddedId = 0;
    #streamRemovedId = 0;
    #audioReadyId = 0;
    #streamNotifyIds = new Map<number, {obj: Wireplumber.Stream; id: number}>();

    @property
    get streams() {
        return this.#streams;
    }

    @property
    get microphoneInUse() {
        return this.#captureStreams.length > 0;
    }

    @property
    get speakerInUse() {
        return this.#streams.length > 0;
    }

    constructor() {
        super();
        // Defer Wireplumber D-Bus proxy to avoid blocking the main loop
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#initAudio();
            return GLib.SOURCE_REMOVE;
        });
    }

    #initAudio(): void {
        let audio: Wireplumber.Audio;
        try {
            audio = Wireplumber.get_default()!.audio;
        } catch (e) {
            logger.error('audio', 'Failed to init Wireplumber:', e);
            return;
        }

        // Initial sync
        this.#syncStreams(audio);

        // Listen for stream add/remove
        this.#streamAddedId = audio.connect('stream-added', (_a, stream) => {
            this.#onStreamAdded(stream);
        });
        this.#streamRemovedId = audio.connect('stream-removed', (_a, stream) => {
            this.#onStreamRemoved(stream);
        });
    }

    #syncStreams(audio: Wireplumber.Audio): void {
        const allStreams = audio.streams ?? [];
        const outStreams: AudioStream[] = [];
        const capStreams: AudioStream[] = [];

        for (const s of allStreams) {
            if (isOutputStream(s.mediaClass)) {
                outStreams.push(streamFromAstal(s));
            } else if (isInputStream(s.mediaClass)) {
                capStreams.push(streamFromAstal(s));
            }
        }

        this.#replaceStreams(outStreams);
        this.#replaceCaptureStreams(capStreams);

        // Subscribe to property changes on all streams
        for (const s of allStreams) {
            this.#subscribeStream(s);
        }
    }

    #onStreamAdded(stream: Wireplumber.Stream): void {
        this.#subscribeStream(stream);
        this.#syncStreams(Wireplumber.get_default()!.audio);
    }

    #onStreamRemoved(stream: Wireplumber.Stream): void {
        this.#unsubscribeStream(stream.id);
        this.#syncStreams(Wireplumber.get_default()!.audio);
    }

    #subscribeStream(stream: Wireplumber.Stream): void {
        if (this.#streamNotifyIds.has(stream.id)) return;
        const id = stream.connect('notify', () => {
            // Volume/mute/description changed — re-sync
            this.#syncStreams(Wireplumber.get_default()!.audio);
        });
        this.#streamNotifyIds.set(stream.id, {obj: stream, id});
    }

    #unsubscribeStream(streamId: number): void {
        const entry = this.#streamNotifyIds.get(streamId);
        if (entry) {
            try {
                entry.obj.disconnect(entry.id);
            } catch {
                /* stream may already be dead */
            }
            this.#streamNotifyIds.delete(streamId);
        }
    }

    #replaceStreams(newStreams: AudioStream[]): void {
        const changed = JSON.stringify(newStreams) !== JSON.stringify(this.#streams);
        const hadStreams = this.#streams.length > 0;

        if (changed) {
            this.#streams = newStreams;
            this.notify('streams');
        }
        if (hadStreams !== newStreams.length > 0) {
            this.notify('speaker-in-use');
        }
    }

    #replaceCaptureStreams(newStreams: AudioStream[]): void {
        const changed = JSON.stringify(newStreams) !== JSON.stringify(this.#captureStreams);
        const hadCapture = this.#captureStreams.length > 0;

        if (changed) {
            this.#captureStreams = newStreams;
            this.notify('capture-streams');
        }
        if (hadCapture !== newStreams.length > 0) {
            this.notify('microphone-in-use');
        }
    }

    #optimisticUpdate(id: number, patch: Partial<AudioStream>) {
        const idx = this.#streams.findIndex((s) => s.id === id);
        if (idx === -1) return;
        this.#streams = [
            ...this.#streams.slice(0, idx),
            {...this.#streams[idx], ...patch},
            ...this.#streams.slice(idx + 1),
        ];
        this.#lastModified.set(id, Date.now());
        this.notify('streams');
    }

    setVolume(id: number, volume: number) {
        const clamped = Math.max(0, Math.min(1, volume));
        this.#optimisticUpdate(id, {volume: clamped});
        Process.execAsync(`wpctl set-volume ${id} ${clamped.toFixed(2)}`).catch((e) =>
            logger.error('audio', 'setVolume wpctl failed:', e)
        );
    }

    setMute(id: number, muted: boolean) {
        this.#optimisticUpdate(id, {muted});
        Process.execAsync(`wpctl set-mute ${id} ${muted ? '1' : '0'}`).catch((e) =>
            logger.error('audio', 'setMute wpctl failed:', e)
        );
    }

    setTargetNode(id: number, nodeId: number) {
        this.#optimisticUpdate(id, {targetNode: nodeId === -1 ? null : nodeId});
        const cmd =
            nodeId === -1
                ? `pw-metadata -n default -d ${id} target.node`
                : `pw-metadata -n default ${id} target.node ${nodeId}`;
        Process.execAsync(cmd).catch((e) => logger.error('audio', 'setTargetNode failed:', e));
    }

    dispose() {
        try {
            const audio = Wireplumber.get_default()?.audio;
            if (audio) {
                if (this.#streamAddedId) audio.disconnect(this.#streamAddedId);
                if (this.#streamRemovedId) audio.disconnect(this.#streamRemovedId);
            }
        } catch {
            /* ignore */
        }
        for (const {obj, id} of this.#streamNotifyIds.values()) {
            try {
                obj.disconnect(id);
            } catch {
                /* ignore */
            }
        }
        this.#streamNotifyIds.clear();
    }
}
