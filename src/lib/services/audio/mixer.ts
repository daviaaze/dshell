import {Process} from '#/lib/core/process';
import GLib from 'gi://GLib?version=2.0';
import GObject, {getter, register} from 'gnim/gobject';
import logger from '#/lib/core/logger';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function streamFromPwItem(item: any): AudioStream | null {
    const info = item.info || {};
    const props = info.props || {};
    const streamProps = info.params?.Props?.[0] || {};

    return {
        id: item.id,
        name: props['node.name'] || 'Unknown',
        appName:
            props['application.name'] ||
            props['node.name'] ||
            'Unknown',
        iconName:
            props['application.icon-name'] ||
            'audio-x-generic-symbolic',
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
        // Empty output — PipeWire may not be running.
        // Log at debug to avoid spamming every 2s.
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
        mc =>
            mc.includes('Stream') &&
            mc.includes('Audio') &&
            mc.includes('Output'),
        'streams'
    );
}

function parseCaptureStreams(pwDump: string): AudioStream[] {
    return parseAudioStreams(
        pwDump,
        mc =>
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
            const match = line.match(
                /id:(\d+)\s+key:'target\.node'\s+value:'(\d+)'/
            );
            if (match) {
                targets.set(parseInt(match[1]!), parseInt(match[2]!));
            }
        }
    } catch (e) {
        logger.error('audio', 'failed to parse targets:', e);
    }
    return targets;
}

@register({GTypeName: 'AppMixer'})
export default class AppMixer extends GObject.Object {
    static readonly instance: AppMixer;
    static get_default() {
        if (!this.instance) this.instance = new AppMixer();
        return this.instance;
    }

    #streams: AudioStream[] = [];
    #captureStreams: AudioStream[] = [];
    #timer: number | null = null;
    #lastModified = new Map<number, number>();
    static readonly MODIFY_GRACE_MS = 3000;

    @getter(Array)
    get streams() {
        return this.#streams;
    }

    @getter(Array)
    get captureStreams() {
        return this.#captureStreams;
    }

    @getter(Boolean)
    get microphoneInUse() {
        return this.#captureStreams.length > 0;
    }

    constructor() {
        super();
        // Initial fetch on next idle cycle to avoid blocking constructor
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#fetchAndUpdate();
            return GLib.SOURCE_REMOVE;
        });
        this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.#fetchAndUpdate();
            return GLib.SOURCE_CONTINUE;
        });
    }

    #fetchAndUpdate() {
        try {
            // Redirect stderr to null: pw-dump writes harmless diagnostics
            // (e.g. "Spa:Enum:ParamId:IO failed") to stderr that clutter logs.
            const pwDump = Process.exec('pw-dump 2>/dev/null');
            const pwMetadata = Process.exec('pw-metadata -n default 2>/dev/null');
            this.#update(pwDump, pwMetadata);
        } catch (e) {
            logger.error('audio', 'pw-dump or pw-metadata failed:', e);
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
                const existing = this.#streams.find(x => x.id === s.id);
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

        const streamsChanged =
            JSON.stringify(newStreams) !== JSON.stringify(this.#streams);
        const captureChanged =
            JSON.stringify(newCaptureStreams) !==
            JSON.stringify(this.#captureStreams);

        if (streamsChanged) {
            this.#streams = newStreams;
            this.notify('streams');
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
        const idx = this.#streams.findIndex(s => s.id === id);
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
        try {
            Process.exec(`wpctl set-volume ${id} ${clamped.toFixed(2)}`);
        } catch (e) {
            logger.error('audio', 'setVolume wpctl failed:', e);
            return;
        }
        this.#optimisticUpdate(id, {volume: clamped});
    }

    setMute(id: number, muted: boolean) {
        try {
            Process.exec(`wpctl set-mute ${id} ${muted ? '1' : '0'}`);
        } catch (e) {
            logger.error('audio', 'setMute wpctl failed:', e);
            return;
        }
        this.#optimisticUpdate(id, {muted});
    }

    setTargetNode(id: number, nodeId: number) {
        try {
            if (nodeId === -1) {
                Process.exec(`pw-metadata -n default -d ${id} target.node`);
            } else {
                Process.exec(
                    `pw-metadata -n default ${id} target.node ${nodeId}`
                );
            }
        } catch (e) {
            logger.error('audio', 'setTargetNode failed:', e);
            return;
        }
        this.#optimisticUpdate(id, {targetNode: nodeId === -1 ? null : nodeId});
    }

    dispose() {
        if (this.#timer) {
            GLib.source_remove(this.#timer);
            this.#timer = null;
        }
    }
}
