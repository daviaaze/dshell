import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject, {getter, register, setter} from 'gnim/gobject';
import logger from '#/lib/logger';
import {Process} from '#/lib/process';
import {getScreenCaptureSettings} from '#/lib/screenCaptureSettings';

enum RecorderBackend {
    WL_SCREENREC = 0,
    WF_RECORDER = 1,
    AUTO = 2,
}

enum RecordingFormat {
    MP4 = 0,
    WEBM = 1,
}

const SCREENSHOT_DIR = `${GLib.get_home_dir()}/Pictures/Screenshots`;
const RECORDING_DIR = `${GLib.get_home_dir()}/Videos`;

// ── Types ─────────────────────────────────────────────────────────

export interface VirtualMonitor {
    name: string;
    resolution: string;
    fps: number;
}

export interface BoundaryGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ── Directory helpers ────────────────────────────────────────────

/**
 * Ensure SCREENSHOT_DIR exists. If it cannot be created, falls back to /tmp
 * and updates SCREENSHOT_DIR. Logs errors via logger.
 */
function ensureScreenshotDir(): string {
    const dir = Gio.File.new_for_path(SCREENSHOT_DIR);
    try {
        if (dir.query_exists(null)) return SCREENSHOT_DIR;
        dir.make_directory_with_parents(null);
        logger.info(
            'screenshot',
            `created screenshot directory: ${SCREENSHOT_DIR}`
        );
        return SCREENSHOT_DIR;
    } catch (e) {
        logger.error(
            'screenshot',
            `failed to create ${SCREENSHOT_DIR}: ${(e as Error).message}, falling back to /tmp`
        );
        return `${GLib.get_tmp_dir()}/shade-screenshots`;
    }
}

const GRIM_BIN = Process.findBinary('grim');

// ── Recording backend args builder ───────────────────────────────

interface RecordingArgs {
    args: string[];
    backendName: string;
}

function buildRecordingArgs(
    backend: RecorderBackend,
    filename: string,
    geometry: string | undefined,
    output: string | undefined,
    audio: boolean,
    format: RecordingFormat = RecordingFormat.MP4
): RecordingArgs {
    const isWebm = format === RecordingFormat.WEBM;
    if (backend === RecorderBackend.WL_SCREENREC) {
        const args = ['wl-screenrec', '-f', filename];
        if (geometry) args.push('-g', geometry);
        if (output) args.push('-o', output);
        if (audio) args.push('--audio');
        // WebM requires a VP* video codec. The muxer is auto-detected from
        // the .webm extension and the audio codec auto-selects opus for it.
        if (isWebm) args.push('--codec', 'vp9');
        return {args, backendName: 'wl-screenrec'};
    } else {
        const args = ['wf-recorder', '-f', filename, '-y'];
        if (geometry) args.push('-g', geometry);
        if (output) args.push('-o', output);
        if (audio) {
            args.push('-a');
            // wf-recorder defaults to aac, which is invalid in a webm muxer.
            if (isWebm) args.push('-C', 'libopus');
        }
        if (isWebm) args.push('-c', 'libvpx');
        return {args, backendName: 'wf-recorder'};
    }
}

@register({GTypeName: 'Screenshot'})
export default class Screenshot extends GObject.Object {
    static instance: Screenshot;

    static get_default() {
        if (!this.instance) this.instance = new Screenshot();
        return this.instance;
    }

    #recording = false;
    #recordingProcess: Process | null = null;
    #audio = false;
    #recordingStartTime = 0;
    #recordingFile = '';
    #durationTimer: number | null = null;
    #recordingElapsed = 0;
    // Recording lifecycle: stop flag + resolved backend name, used by the
    // exit handler to distinguish a user-requested stop from a crash and to
    // report the correct backend in notifications.
    #stopRequested = false;
    #recordingIsRetry = false;
    #recordingBackendName = '';

    // ── Overlay state ────────────────────────────────────────────────
    #overlayOpen = false;
    #selectedMode: 'screenshot' | 'recording' = 'screenshot';
    #selectedTarget: 'fullscreen' | 'area' | 'window' | 'monitor' =
        'fullscreen';
    #regionSelectorOpen = false;
    #pendingCaptureGeometry: string | null = null;

    // ── Freeze state ─────────────────────────────────────────────────
    #freezeActive = false;
    #freezeProcess: Process | null = null;
    // True between the user confirming a selection and the capture actually
    // running. Prevents the regionSelectorOpen setter from unfreezing when the
    // selector closes on confirm (the frozen frame is still needed by grim).
    #freezeCapturePending = false;

    // ── Boundary state ───────────────────────────────────────────────
    #boundaryVisible = false;
    #boundaryGeometry: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null = null;

    // ── Virtual monitors ─────────────────────────────────────────────
    #virtualMonitors: VirtualMonitor[] = [];

    @getter(Number)
    get recordingElapsed() {
        return this.#recordingElapsed;
    }

    @getter(Boolean)
    get recording() {
        return this.#recording;
    }

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

    // ── Overlay state getters/setters ─────────────────────────────────

    @getter(Boolean)
    get overlayOpen() {
        return this.#overlayOpen;
    }

    @setter(Boolean)
    set overlayOpen(v: boolean) {
        if (this.#overlayOpen === v) return;
        this.#overlayOpen = v;
        this.notify('overlay-open');
    }

    @getter(String)
    get selectedMode() {
        return this.#selectedMode;
    }

    @setter(String)
    set selectedMode(v: 'screenshot' | 'recording') {
        this.#selectedMode = v;
        this.notify('selected-mode');
    }

    @getter(String)
    get selectedTarget() {
        return this.#selectedTarget;
    }

    @setter(String)
    set selectedTarget(v: 'fullscreen' | 'area' | 'window' | 'monitor') {
        this.#selectedTarget = v;
        this.notify('selected-target');
    }

    // ── Region selector state ────────────────────────────────────────

    @getter(Boolean)
    get regionSelectorOpen() {
        return this.#regionSelectorOpen;
    }

    @setter(Boolean)
    set regionSelectorOpen(v: boolean) {
        if (this.#regionSelectorOpen === v) return;
        this.#regionSelectorOpen = v;
        this.notify('region-selector-open');
        if (v) {
            // Opening the region selector: freeze outputs so the user can
            // draw a selection on a stable frame (GNOME/Sway area-screenshot
            // UX). startFreeze is a no-op if wayfreeze is unavailable.
            this.startFreeze();
        } else if (this.#freezeActive && !this.#freezeCapturePending) {
            // Closing without a pending capture = the user cancelled: release
            // the freeze so outputs resume immediately.
            this.stopFreeze();
        }
    }

    @getter(String)
    get pendingCaptureGeometry() {
        return this.#pendingCaptureGeometry || '';
    }

    @setter(String)
    set pendingCaptureGeometry(v: string | null) {
        this.#pendingCaptureGeometry = v;
        this.notify('pending-capture-geometry');
    }

    /** Open the region-selector to pick an area for capture */
    openRegionSelectorForCapture(mode: 'screenshot' | 'recording') {
        this.selectedMode = mode;
        this.selectedTarget = 'area';
        // Open the region-selector directly. Callers that live inside a
        // popover (QS buttons) are expected to dismiss it first so the
        // selector gets a clean grab.
        this.regionSelectorOpen = true;
    }

    /** Called by region-selector when user confirms a selection */
    captureArea(geometry: string) {
        this.pendingCaptureGeometry = geometry;
        // Keep the freeze alive through the unmap delay; the setter won't
        // release it because a capture is pending.
        this.#freezeCapturePending = true;
        this.regionSelectorOpen = false;

        // Defer capture so the region-selector window has time to unmap,
        // otherwise grim/wl-screenrec capture the selector overlay itself.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this.#freezeCapturePending = false;
            if (this.#selectedMode === 'screenshot') {
                // screenshotGeometry releases the freeze once grim has the
                // frame (we want the frozen frame for a still capture).
                this.screenshotGeometry(geometry);
            } else {
                // Recording must capture LIVE content, so unfreeze as soon as
                // the recorder process is launched (it has its own grab).
                this.startRecording({geometry});
                this.stopFreeze();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Take a screenshot of a specific geometry */
    screenshotGeometry(geometry: string) {
        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        Process.execAsync(`${GRIM_BIN} -g "${geometry}" "${filename}"`)
            .then(() => {
                Process.execAsync(
                    `sh -c 'wl-copy -t image/png < "${filename}"'`
                ).catch(e =>
                    logger.warn('screenshot', 'wl-copy failed:', e)
                );
                this.#notify(
                    'Screenshot saved',
                    filename,
                    'camera-photo-symbolic'
                );
                this.stopFreeze();
            })
            .catch(e => {
                logger.error('screenshot', 'grim failed:', e);
                this.stopFreeze();
            });
    }

    // ── Freeze state getters/setters ──────────────────────────────────

    @getter(Boolean)
    get freezeActive() {
        return this.#freezeActive;
    }

    @setter(Boolean)
    set freezeActive(v: boolean) {
        if (this.#freezeActive === v) return;
        this.#freezeActive = v;
        this.notify('freeze-active');
    }

    // ── Boundary state getters/setters ────────────────────────────────

    @getter(Boolean)
    get boundaryVisible() {
        return this.#boundaryVisible;
    }

    @setter(Boolean)
    set boundaryVisible(v: boolean) {
        if (this.#boundaryVisible === v) return;
        this.#boundaryVisible = v;
        this.notify('boundary-visible');
    }

    @getter(Object)
    get boundaryGeometry() {
        return this.#boundaryGeometry;
    }

    @setter(Object)
    set boundaryGeometry(v: BoundaryGeometry | null) {
        this.#boundaryGeometry = v;
        this.notify('boundary-geometry');
    }

    // ── Virtual monitors ──────────────────────────────────────────────

    @getter(Array)
    get virtualMonitors() {
        return [...this.#virtualMonitors];
    }

    /** Whether at least one virtual monitor is active (bindable boolean). */
    @getter(Boolean)
    get virtualMonitorActive() {
        return this.#virtualMonitors.length > 0;
    }

    #notify(
        title: string,
        body: string,
        icon: string = 'dialog-information-symbolic'
    ) {
        Process.execAsync(
            `notify-send -a shade-shell -i ${icon} "${title}" "${body}"`
        ).catch(e => logger.warn('screenshot', 'notify-send failed:', e));
    }

    screenshot(fullscreen: boolean) {
        // For area selection, use the overlay's region-selector instead of slurp
        if (!fullscreen) {
            this.openRegionSelectorForCapture('screenshot');
            return;
        }

        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        Process.execAsync(`${GRIM_BIN} "${filename}"`)
            .then(() => {
                Process.execAsync(
                    `sh -c 'wl-copy -t image/png < "${filename}"'`
                ).catch(e =>
                    logger.warn('screenshot', 'wl-copy failed:', e)
                );
                this.#notify(
                    'Screenshot saved',
                    filename,
                    'camera-photo-symbolic'
                );
            })
            .catch(e => logger.error('screenshot', 'grim failed:', e));
    }

    toggleRecording() {
        if (this.#recording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    startRecording(
        options: {geometry?: string; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        if (this.#recording) return;

        // Read backend + format preference from GSettings. When the caller
        // forces a backend (auto-fallback path), honor it directly.
        const settings = getScreenCaptureSettings();
        const pref =
            forceBackend ?? (settings.recorderBackend() as RecorderBackend);
        const backend = this.#resolveBackend(pref);
        const format = settings.recordingFormat() as RecordingFormat;
        const ext = format === RecordingFormat.WEBM ? 'webm' : 'mp4';

        GLib.mkdir_with_parents(RECORDING_DIR, 0o755);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${RECORDING_DIR}/${timestamp}.${ext}`;

        // If no geometry and no output specified, default to focused monitor
        const effectiveOutput =
            options.output ??
            (options.geometry
                ? undefined
                : AstalHyprland.get_default().focused_monitor?.name);

        // Build args based on backend
        const {args, backendName} = buildRecordingArgs(
            backend,
            filename,
            options.geometry,
            effectiveOutput,
            this.#audio,
            format
        );

        logger.info(
            'screenshot',
            `starting ${backendName} with args: ${args.join(' ')}`
        );

        let proc: Process;
        try {
            proc = Process.subprocessv(args);
        } catch (e) {
            logger.error(
                'screenshot',
                `failed to spawn ${backendName}: ${(e as Error).message}`
            );
            this.#notify(
                'Recording failed',
                `Could not start ${backendName}: ${(e as Error).message}`,
                'dialog-error-symbolic'
            );
            return;
        }

        this.#recording = true;
        this.#stopRequested = false;
        this.#recordingIsRetry = forceBackend !== undefined;
        this.#recordingFile = filename;
        this.#recordingStartTime = Date.now();
        this.#recordingElapsed = 0;
        this.#recordingProcess = proc;
        this.#recordingBackendName = backendName;
        this.notify('recording');
        this.notify('recording-elapsed');

        // Start duration timer
        this.#durationTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            1000,
            () => {
                this.#recordingElapsed = Math.floor(
                    (Date.now() - this.#recordingStartTime) / 1000
                );
                this.notify('recording-elapsed');
                return this.#recording; // keep running while recording
            }
        );

        this.#notify('Recording started', filename, 'media-record-symbolic');

        // Show recording boundary if enabled
        if (options.geometry) {
            const [pos, size] = options.geometry.split(' ');
            const [x, y] = pos.split(',').map(Number);
            const [w, h] = size.split('x').map(Number);
            this.showBoundary({x, y, width: w, height: h});
        }

        proc.connect('exit', () => {
            const durationMs = Date.now() - this.#recordingStartTime;
            const durationStr = this.#formatDuration(durationMs);
            const success = this.#stopRequested || durationMs >= 1000;
            const name = this.#recordingBackendName || backendName;

            // Auto-fallback: wl-screenrec can die fast when no vaapi/GPU is
            // available. If "auto" was requested, transparently retry once
            // with wf-recorder before reporting failure.
            if (
                !success &&
                !this.#recordingIsRetry &&
                backend === RecorderBackend.WL_SCREENREC &&
                pref === RecorderBackend.AUTO
            ) {
                logger.warn(
                    'screenshot',
                    `${name} exited after ${durationMs}ms; retrying with wf-recorder`
                );
                this.#resetRecordingProcess();
                this.startRecording(options, RecorderBackend.WF_RECORDER);
                return;
            }

            logger.info(
                'screenshot',
                `${name} exited after ${durationStr} (${durationMs}ms)`
            );

            if (success) {
                this.#notify(
                    'Recording stopped',
                    `Duration: ${durationStr}\nSaved to: ${this.#recordingFile}`,
                    'media-playback-stop-symbolic'
                );
            } else {
                this.#notify(
                    'Recording failed',
                    `${name} exited immediately (${durationMs}ms). Check geometry/output and that no other recorder is running.`,
                    'dialog-error-symbolic'
                );
            }

            this.#resetRecordingProcess();
            this.notify('recording');
            this.notify('recording-elapsed');
        });
    }

    #resolveBackend(pref: RecorderBackend): RecorderBackend {
        if (pref === RecorderBackend.AUTO) {
            // Prefer wl-screenrec (GPU/vaapi) when installed; otherwise fall
            // back to wf-recorder. wl-screenrec also gets a runtime fallback
            // in the exit handler if it dies fast (e.g. no vaapi on NVIDIA).
            return Process.findBinary('wl-screenrec') !== 'wl-screenrec'
                ? RecorderBackend.WL_SCREENREC
                : RecorderBackend.WF_RECORDER;
        }
        return pref;
    }

    #resetRecordingProcess() {
        // Tear down the active recording's internal state without emitting
        // signals/notifications. Used by both the final exit path (which then
        // notifies) and the auto-fallback retry path (which re-launches).
        this.#recording = false;
        this.#stopRequested = false;
        if (this.#durationTimer) {
            GLib.Source.remove(this.#durationTimer);
            this.#durationTimer = null;
        }
        this.hideBoundary();
        this.#recordingProcess = null;
        this.#recordingFile = '';
        this.#recordingStartTime = 0;
        this.#recordingElapsed = 0;
        this.#recordingBackendName = '';
    }

    #formatDuration(ms: number): string {
        const totalSeconds = Math.round(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    recordArea() {
        if (this.#recording) return;
        this.openRegionSelectorForCapture('recording');
    }

    /** Record a specific output (monitor) by name */
    recordOutput(outputName?: string) {
        if (this.#recording) return;
        if (!outputName) {
            const hyprland = AstalHyprland.get_default();
            outputName = hyprland.focused_monitor?.name;
            logger.info('screenshot', `focused monitor name: ${outputName}`);
        }
        if (!outputName) {
            logger.error('screenshot', 'no output name, cannot record output');
            this.#notify(
                'Recording failed',
                'No monitor found',
                'dialog-error-symbolic'
            );
            return;
        }
        this.startRecording({output: outputName});
    }

    /** Visually select an output (monitor) to record: open overlay for selection */
    recordOutputVisual() {
        if (this.#recording) return;
        this.selectedMode = 'recording';
        this.selectedTarget = 'monitor';
        this.overlayOpen = true;
    }

    /** Visually select a window to record: open overlay for selection */
    recordWindowVisual() {
        if (this.#recording) return;
        this.selectedMode = 'recording';
        this.selectedTarget = 'window';
        this.overlayOpen = true;
    }

    /** Record a specific window by address */
    recordWindowByAddress(address: string) {
        if (this.#recording) return;
        const hyprland = AstalHyprland.get_default();
        const clients = hyprland.clients || [];
        const target = clients.find(c => c.address === address);
        if (!target) {
            logger.error(
                'screenshot',
                `window with address ${address} not found`
            );
            this.#notify(
                'Recording failed',
                'Window not found',
                'dialog-error-symbolic'
            );
            return;
        }
        const geometry = `${target.x},${target.y} ${target.width}x${target.height}`;
        logger.debug('screenshot', `window geometry: ${geometry}`);
        this.startRecording({geometry});
    }

    recordWindow() {
        if (this.#recording) return;
        const hyprland = AstalHyprland.get_default();
        const client = hyprland.focused_client;
        if (!client) {
            logger.error(
                'screenshot',
                'no focused client, cannot record window'
            );
            this.#notify(
                'Recording failed',
                'No window focused',
                'dialog-error-symbolic'
            );
            return;
        }
        const geometry = `${client.x},${client.y} ${client.width}x${client.height}`;
        logger.debug('screenshot', `window geometry: ${geometry}`);
        this.startRecording({geometry});
    }

    stopRecording() {
        if (!this.#recordingProcess) return;
        this.#stopRequested = true;
        try {
            this.#recordingProcess.signal(2);
        } catch (e) {
            // Process may already be dead; escalate to SIGTERM (matching
            // stopFreeze/dispose) and swallow to protect the caller.
            logger.warn(
                'screenshot',
                `SIGINT to recorder failed: ${(e as Error).message}`
            );
            try {
                this.#recordingProcess.signal(15);
            } catch {
                /* already dead */
            }
        }
    }

    // ── Overlay management ────────────────────────────────────────────

    toggleOverlay() {
        this.overlayOpen = !this.#overlayOpen;
    }

    showOverlay() {
        this.overlayOpen = true;
    }

    hideOverlay() {
        this.overlayOpen = false;
    }

    // ── Freeze management ────────────────────────────────────────────

    startFreeze() {
        if (this.#freezeActive) return;
        try {
            const proc = Process.subprocessv(['wayfreeze', '--hide-cursor']);
            this.#freezeProcess = proc;
            this.freezeActive = true;
            proc.connect('exit', () => {
                this.#freezeProcess = null;
                this.freezeActive = false;
            });
        } catch {
            logger.warn(
                'screenshot',
                'wayfreeze not available, skipping freeze'
            );
        }
    }

    stopFreeze() {
        if (this.#freezeProcess) {
            try {
                this.#freezeProcess.signal(2);
                this.#freezeProcess.signal(15);
            } catch {
                /* already dead */
            }
            this.#freezeProcess = null;
        }
        this.freezeActive = false;
    }

    // ── Recording boundary ────────────────────────────────────────────

    showBoundary(geometry: BoundaryGeometry) {
        this.boundaryGeometry = geometry;
        this.boundaryVisible = true;
    }

    hideBoundary() {
        this.boundaryVisible = false;
        this.boundaryGeometry = null;
    }

    // ── Virtual monitors ──────────────────────────────────────────────

    async createVirtualMonitor(
        resolution = '1920x1080',
        fps = 60
    ): Promise<VirtualMonitor | null> {
        try {
            await Process.execAsync('hyprctl output create headless SHADE-VMON');

            // The new headless output isn't registered instantly; poll until
            // it shows up (or give up after ~1s). Uses async exec so the shell
            // main loop isn't blocked while waiting.
            let vmon: {name: string} | null = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const monitors = JSON.parse(
                    await Process.execAsync('hyprctl -j monitors all')
                );
                vmon =
                    monitors.find((m: {name: string}) =>
                        m.name.startsWith('SHADE-VMON')
                    ) ??
                    monitors.find((m: {name: string}) =>
                        m.name.startsWith('HEADLESS')
                    ) ??
                    null;
                if (vmon) break;
                await new Promise<void>(resolve =>
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    })
                );
            }

            if (!vmon) {
                logger.error(
                    'screenshot',
                    'failed to find created virtual monitor'
                );
                this.#notify(
                    'Virtual monitor',
                    'Hyprland did not register the headless output.',
                    'dialog-error-symbolic'
                );
                return null;
            }

            await Process.execAsync(
                `hyprctl keyword monitor ${vmon.name},${resolution}@${fps},auto-right,1`
            );
            const vm: VirtualMonitor = {name: vmon.name, resolution, fps};
            this.#virtualMonitors.push(vm);
            this.notify('virtual-monitors');
            this.notify('virtual-monitor-active');
            logger.info(
                'screenshot',
                `created virtual monitor: ${vm.name} (${resolution}@${fps})`
            );
            return vm;
        } catch (e) {
            logger.error(
                'screenshot',
                `failed to create virtual monitor: ${(e as Error).message}`
            );
            this.#notify(
                'Virtual monitor',
                `Could not create virtual monitor: ${(e as Error).message}`,
                'dialog-error-symbolic'
            );
            return null;
        }
    }

    removeVirtualMonitors() {
        for (const vm of this.#virtualMonitors) {
            try {
                Process.exec(`hyprctl output remove ${vm.name}`);
                logger.info(
                    'screenshot',
                    `removed virtual monitor: ${vm.name}`
                );
            } catch (e) {
                logger.warn(
                    'screenshot',
                    `failed to remove ${vm.name}: ${(e as Error).message}`
                );
            }
        }
        this.#virtualMonitors = [];
        this.notify('virtual-monitors');
        this.notify('virtual-monitor-active');
    }

    dispose() {
        // Kill any active freeze process first (screenshot overlay)
        if (this.#freezeProcess) {
            try {
                this.#freezeProcess.signal(2);
                this.#freezeProcess.signal(15);
            } catch {
                /* process may already be dead */
            }
            this.#freezeProcess = null;
        }
        if (this.#durationTimer) {
            GLib.Source.remove(this.#durationTimer);
            this.#durationTimer = null;
        }
        if (this.#recordingProcess) {
            this.#stopRequested = true;
            try {
                this.#recordingProcess.signal(2);
            } catch {
                /* process may already be dead */
            }
            this.#recordingProcess = null;
        }
    }
}
