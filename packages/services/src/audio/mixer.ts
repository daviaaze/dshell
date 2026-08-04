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

// ── Shared pipewire stream parser ──

interface PwDumpItem {
    id: number;
    info?: {
        props?: Record<string, string>;
        params?: {
            Props?: Array<{volume?: number; mute?: boolean}>;
        };
    };
}

function streamFromPwItem(item: PwDumpItem): AudioStream | null {
    const info = item.info ?? {};
    const props = info.props ?? {};
    const streamProps = info.params?.Props?.[0] || {};

    return {
        id: item.id,
        name: props['node.name'] || 'Unknown',
        appName: props['application.name'] || props['node.name'] || 'Unknown',
        iconName: props['application.icon-name'] || 'audio-x-generic-symbolic',
        volume: streamProps.volume ?? 1.0,
        muted: streamProps.mute ?? false,
        targetNode: null,
    };
}

function parseAudioStreams(
    pwDump: string,
    predicate: (mediaClass: string) => boolean,
    errorLabel: string
): AudioStream[] {
    if (!pwDump.trim()) {
        logger.debug('audio', `${errorLabel}: pw-dump returned empty (PipeWire not running?)`);
        return [];
    }
    try {
        const data = JSON.parse(pwDump);
        const streams: AudioStream[] = [];
        for (const item of data) {
            const props = item.info?.props || {};
            if (!predicate(props['media.class'] || '')) continue;
            const stream = streamFromPwItem(item);
            if (stream) streams.push(stream);
        }
        return streams;
    } catch (e) {
        logger.error('audio', `failed to parse ${errorLabel}:`, e);
        return [];
    }
}

function parseStreams(pwDump: string): AudioStream[] {
    return parseAudioStreams(
        pwDump,
        (mc) => mc.includes('Stream') && mc.includes('Audio') && mc.includes('Output'),
        'streams'
    );
}

function parseCaptureStreams(pwDump: string): AudioStream[] {
    return parseAudioStreams(
        pwDump,
        (mc) =>
            mc.includes('Stream') &&
            mc.includes('Audio') &&
            mc.includes('Input') &&
            !mc.includes('Internal'),
        'capture streams'
    );
}

function parseTargets(pwMetadata: string): Map<number, number> {
    const targets = new Map<number, number>();
    try {
        for (const line of pwMetadata.split('\n')) {
            const match = line.match(/id:(\d+)\s+key:'target\.node'\s+value:'(\d+)'/);
            if (match) {
                targets.set(parseInt(match[1]!), parseInt(match[2]!));
            }
        }
    } catch (e) {
        logger.error('audio', 'failed to parse targets:', e);
    }
    return targets;
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
    #timer: number | null = null;
    #lastModified = new Map<number, number>();
    #busInitialized = false;
    static readonly MODIFY_GRACE_MS = 3000;

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
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#fetchAndUpdate();
            return GLib.SOURCE_REMOVE;
        });
        this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.#fetchAndUpdate();
            return GLib.SOURCE_CONTINUE;
        });
    }

    #inFlight = false;

    async #fetchAndUpdate(): Promise<void> {
        if (this.#inFlight) return;
        this.#inFlight = true;
        try {
            const [pwDump, pwMetadata] = await Promise.all([
                Process.execAsync('pw-dump', {silenceStderr: true}),
                Process.execAsync('pw-metadata -n default', {
                    silenceStderr: true,
                }),
            ]);
            this.#update(pwDump, pwMetadata);
        } catch (e) {
            logger.error('audio', 'pw-dump or pw-metadata failed:', e);
        } finally {
            this.#inFlight = false;
        }
    }

    #update(pwDump: string, pwMetadata: string) {
        const newStreams = parseStreams(pwDump);
        const newCaptureStreams = parseCaptureStreams(pwDump);
        const targets = parseTargets(pwMetadata);
        const now = Date.now();

        for (const s of newStreams) {
            s.targetNode = targets.get(s.id) ?? null;
            const lastMod = this.#lastModified.get(s.id);
            if (lastMod && now - lastMod < AppMixer.MODIFY_GRACE_MS) {
                const existing = this.#streams.find((x) => x.id === s.id);
                if (existing) {
                    s.volume = existing.volume;
                    s.muted = existing.muted;
                    s.targetNode = existing.targetNode;
                }
            }
        }
        for (const s of newCaptureStreams) {
            s.targetNode = targets.get(s.id) ?? null;
        }

        const streamsChanged = JSON.stringify(newStreams) !== JSON.stringify(this.#streams);
        const captureChanged =
            JSON.stringify(newCaptureStreams) !== JSON.stringify(this.#captureStreams);

        const hadStreams = this.#streams.length > 0;
        if (streamsChanged) {
            this.#streams = newStreams;
            this.notify('streams');
        }
        if (hadStreams !== newStreams.length > 0) {
            this.notify('speaker-in-use');
        }
        const hadCapture = this.#captureStreams.length > 0;
        if (captureChanged) {
            this.#captureStreams = newCaptureStreams;
            this.notify('capture-streams');
        }
        if (hadCapture !== newCaptureStreams.length > 0) {
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
        if (this.#timer) {
            GLib.source_remove(this.#timer);
            this.#timer = null;
        }
    }
}