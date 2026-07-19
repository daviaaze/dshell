import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import logger from '#/lib/core/logger';
import {Process} from '#/lib/core/process';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';
import {RecorderBackend, RecordingFormat} from './types';
import {
    buildRecordingArgs,
    resolveBackend,
    formatDuration,
    notify,
    RECORDING_DIR,
} from './utils';

const ICON_ERROR = 'dialog-error-symbolic';
const MSG_RECORDING_FAILED = 'Recording failed';

export interface RecorderHooks {
    /** Current audio settings from the Screenshot service. */
    getAudioSettings(): {audio: boolean; input: number; quality: number};
    /** Show the recording boundary for a "x,y WxH" geometry string. */
    showBoundary(geometry: string): void;
    hideBoundary(): void;
    /** Fired whenever `recording` or `elapsed` changes (GObject notify). */
    notifyState(): void;
}

/**
 * Screen-recording pipeline: backend resolution, process lifecycle,
 * duration timer, exit handling with automatic wf-recorder fallback.
 *
 * Extracted from the Screenshot service — Screenshot owns the GObject
 * properties and delegates all recording work here.
 */
export class Recorder {
    #hooks: RecorderHooks;

    #recording = false;
    #process: Process | null = null;
    #startTime = 0;
    #file = '';
    #durationTimer: number | null = null;
    #elapsed = 0;
    // Recording lifecycle: stop flag + resolved backend name, used by the
    // exit handler to distinguish a user-requested stop from a crash and to
    // report the correct backend in notifications.
    #stopRequested = false;
    #isRetry = false;
    #backendName = '';

    constructor(hooks: RecorderHooks) {
        this.#hooks = hooks;
    }

    get recording(): boolean {
        return this.#recording;
    }

    get elapsed(): number {
        return this.#elapsed;
    }

    toggle() {
        if (this.#recording) {
            this.stop();
        } else {
            this.start();
        }
    }

    start(
        options: {geometry?: string; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        if (this.#recording) return;

        const settings = getScreenCaptureSettings();
        const pref = forceBackend ?? (settings.recorderBackend() as RecorderBackend);
        const backend = resolveBackend(pref);
        const format = settings.recordingFormat() as RecordingFormat;
        const ext = format === RecordingFormat.WEBM ? 'webm' : 'mp4';

        const filename = this.#resolveFilename(ext);
        const effectiveOutput =
            options.output ??
            (options.geometry
                ? undefined
                : AstalHyprland.get_default().focused_monitor?.name);

        const {audio, input, quality} = this.#hooks.getAudioSettings();
        const {args, backendName} = buildRecordingArgs(
            backend, filename, options.geometry, effectiveOutput,
            audio, format, input, quality,
        );

        logger.info('screenshot', `starting ${backendName} with args: ${args.join(' ')}`);

        const proc = this.#spawn(args, backendName);
        if (!proc) return;

        this.#initState(proc, filename, backendName, forceBackend);
        this.#startDurationTimer();

        notify('Recording started', filename, 'media-record-symbolic');

        if (options.geometry) this.#hooks.showBoundary(options.geometry);

        proc.connect('exit', () => this.#onExit(proc, options, backend, pref));
    }

    stop() {
        if (!this.#process) return;
        this.#stopRequested = true;
        try {
            this.#process.signal(2);
        } catch (e) {
            logger.warn(
                'screenshot',
                `SIGINT to recorder failed: ${e instanceof Error ? e.message : String(e)}`
            );
            try {
                this.#process.signal(15);
            } catch {
                /* already dead */
            }
        }
    }

    dispose() {
        if (this.#durationTimer) {
            GLib.Source.remove(this.#durationTimer);
            this.#durationTimer = null;
        }
        if (this.#process) {
            this.#stopRequested = true;
            try {
                this.#process.signal(2);
            } catch {
                /* process may already be dead */
            }
            this.#process = null;
        }
    }

    // ── Internal ──

    #resolveFilename(ext: string): string {
        GLib.mkdir_with_parents(RECORDING_DIR, 0o755);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${RECORDING_DIR}/${timestamp}.${ext}`;
    }

    #spawn(args: string[], backendName: string): Process | null {
        try {
            return Process.subprocessv(args);
        } catch (e) {
            logger.error('screenshot', `failed to spawn ${backendName}: ${e instanceof Error ? e.message : String(e)}`);
            notify(MSG_RECORDING_FAILED, `Could not start ${backendName}: ${e instanceof Error ? e.message : String(e)}`, ICON_ERROR);
            return null;
        }
    }

    #initState(
        proc: Process,
        filename: string,
        backendName: string,
        forceBackend: RecorderBackend | undefined,
    ) {
        this.#recording = true;
        this.#stopRequested = false;
        this.#isRetry = forceBackend !== undefined;
        this.#file = filename;
        this.#startTime = Date.now();
        this.#elapsed = 0;
        this.#process = proc;
        this.#backendName = backendName;
        this.#hooks.notifyState();
    }

    #startDurationTimer() {
        this.#durationTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#elapsed = Math.floor((Date.now() - this.#startTime) / 1000);
            this.#hooks.notifyState();
            return this.#recording;
        });
    }

    #onExit(
        proc: Process,
        options: {geometry?: string; output?: string},
        backend: RecorderBackend,
        pref: RecorderBackend,
    ) {
        const durationMs = Date.now() - this.#startTime;
        const durationStr = formatDuration(durationMs);
        const success = this.#stopRequested || durationMs >= 1000;
        const name = this.#backendName || '';

        if (!success && !this.#isRetry && backend === RecorderBackend.WL_SCREENREC && pref === RecorderBackend.AUTO) {
            logger.warn('screenshot', `${name} exited after ${durationMs}ms; retrying with wf-recorder`);
            this.#reset();
            this.start(options, RecorderBackend.WF_RECORDER);
            return;
        }

        logger.info('screenshot', `${name} exited after ${durationStr} (${durationMs}ms)`);

        if (success) {
            notify('Recording stopped', `Duration: ${durationStr}\nSaved to: ${this.#file}`, 'media-playback-stop-symbolic');
        } else {
            notify(MSG_RECORDING_FAILED, `${name} exited immediately (${durationMs}ms). Check geometry/output and that no other recorder is running.`, ICON_ERROR);
        }

        this.#reset();
        this.#hooks.notifyState();
    }

    #reset() {
        this.#recording = false;
        this.#stopRequested = false;
        if (this.#durationTimer) {
            GLib.Source.remove(this.#durationTimer);
            this.#durationTimer = null;
        }
        this.#hooks.hideBoundary();
        this.#process = null;
        this.#file = '';
        this.#startTime = 0;
        this.#elapsed = 0;
        this.#backendName = '';
    }
}
