import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import AstalWp from 'gi://AstalWp?version=0.1';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject, {getter, register, setter} from 'gnim/gobject';
import logger from '#/lib/core/logger';
import {Process} from '#/lib/core/process';
import {getScreenCaptureSettings} from '#/lib/settings/screenCapture';
import {RecorderBackend, RecordingFormat, type VirtualMonitor, type BoundaryGeometry} from './types';
import {
    ensureScreenshotDir,
    buildRecordingArgs,
    resolveBackend,
    formatDuration,
    notify,
    copyImageToClipboard,
    GRIM_BIN,
    MAGICK_BIN,
    RECORDING_DIR,
} from './utils';

export {RecorderBackend, RecordingFormat} from './types';
export type {VirtualMonitor, BoundaryGeometry} from './types';

@register({GTypeName: 'Screenshot'})
export default class Screenshot extends GObject.Object {
    static readonly instance: Screenshot;

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

    // ── Stage texture (frozen frame) ───────────────────────────────────
    #stagePixPath: string | null = null;
    #stageTexture: Gdk.Texture | null = null;

    // ── Freeze state ─────────────────────────────────────────────────
    #freezeActive = false;
    #freezeProcess: Process | null = null;
    // True between the user confirming a selection and the capture actually
    // running. Prevents the regionSelectorOpen setter from unfreezing when the
    // selector closes on confirm (the frozen frame is still needed by grim).
    #freezeCapturePending = false;
    // True when the overlay closes but we want to keep the freeze alive for a
    // pending area-capture transition (overlay → region-selector gap).
    #freezeKeepAlive = false;

    @getter(Boolean)
    get freezeKeepAlive() {
        return this.#freezeKeepAlive;
    }

    // ── Boundary state ───────────────────────────────────────────────
    #boundaryVisible = false;
    #boundaryGeometry: BoundaryGeometry | null = null;

    // ── Virtual monitors ─────────────────────────────────────────────
    #virtualMonitors: VirtualMonitor[] = [];

    // ── Audio input selection ────────────────────────────────────────
    #selectedAudioInput = -1; // -1 = system default
    #selectedAudioInputName = 'System Default';

    // ── Recording quality ────────────────────────────────────────────
    #recordingQuality = 1; // 0=Low, 1=Medium, 2=High

    // ── Preview thumbnails ───────────────────────────────────────────
    #previewThumbnails = true;

    // ── Getters / Setters ────────────────────────────────────────────

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

    // ── Overlay state getters/setters ─────────────────────────────────

    @getter(Boolean)
    get overlayOpen() {
        return this.#overlayOpen;
    }

    @setter(Boolean)
    set overlayOpen(v: boolean) {
        if (this.#overlayOpen === v) return;

        if (v) {
            this.#captureStageSync();
            if (!this.#stagePixPath) {
                logger.warn('screenshot', 'stage capture failed, overlay will show live screen');
            }
        }

        this.#overlayOpen = v;
        this.notify('overlay-open');

        if (!v) {
            this.#cleanupStage();
        }
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
            this.startFreeze();
        } else if (this.#freezeActive && !this.#freezeCapturePending) {
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
        this.regionSelectorOpen = true;
    }

    /** Called by region-selector when user confirms a selection */
    captureArea(geometry: string) {
        this.pendingCaptureGeometry = geometry;
        this.#freezeCapturePending = true;
        this.regionSelectorOpen = false;

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this.#freezeCapturePending = false;
            if (this.#selectedMode === 'screenshot') {
                if (this.#stagePixPath) {
                    this.captureFromStage(geometry);
                } else {
                    this.screenshotGeometry(geometry);
                }
            } else {
                this.startRecording({geometry});
                this.stopFreeze();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Stage capture and crop ───────────────────────────────────────

    #captureStageSync() {
        this.#cleanupStage();

        const hyprland = AstalHyprland.get_default();
        const monitor = hyprland.focused_monitor;
        const monitorName = monitor?.name || '';

        const stagePix = `${GLib.get_tmp_dir()}/dshell-stage-${Date.now()}.png`;

        try {
            if (monitorName) {
                Process.exec(`${GRIM_BIN} -o "${monitorName}" "${stagePix}"`);
            } else {
                Process.exec(`${GRIM_BIN} "${stagePix}"`);
            }
        } catch (e) {
            logger.error('screenshot', `stage capture failed: ${e}`);
            return;
        }

        this.#stagePixPath = stagePix;
        this.#stageTexture = Gdk.Texture.new_from_filename(stagePix);
        this.notify('stage-texture');
    }

    #cleanupStage() {
        if (this.#stageTexture) {
            this.#stageTexture = null;
            this.notify('stage-texture');
        }
        if (this.#stagePixPath) {
            try {
                const f = Gio.File.new_for_path(this.#stagePixPath);
                f.delete(null);
            } catch { /* file may already be deleted */ }
            this.#stagePixPath = null;
        }
    }

    async captureFromStage(geometry: string | null) {
        if (!this.#stagePixPath) {
            logger.error('screenshot', 'no stage texture for capture');
            notify(
                'Screenshot failed',
                'No frozen frame available',
                ICON_ERROR
            );
            return;
        }

        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        try {
            if (geometry) {
                logger.info(
                    'screenshot',
                    `captureFromStage: crop ${geometry} from stage`
                );
                await Process.execAsync(
                    `${MAGICK_BIN} "${this.#stagePixPath}" -crop ${geometry} +repage "${filename}"`
                );
            } else {
                logger.info('screenshot', 'captureFromStage: full stage copy');
                await Process.execAsync(
                    `cp "${this.#stagePixPath}" "${filename}"`
                );
            }

            copyImageToClipboard(filename);
            notify('Screenshot saved', filename, 'camera-photo-symbolic');
            this.overlayOpen = false;
        } catch (e) {
            logger.error('screenshot', `capture failed: ${e}`);
            notify(
                'Screenshot failed',
                String(e),
                ICON_ERROR
            );
        }
    }

    @getter(GObject.Object)
    get stageTexture(): Gdk.Texture | null {
        return this.#stageTexture;
    }

    screenshotGeometry(geometry: string) {
        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        Process.execAsync(`${GRIM_BIN} -g "${geometry}" "${filename}"`)
            .then(() => {
                copyImageToClipboard(filename);
                notify(
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

    // ── Freeze state ─────────────────────────────────────────────────

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

    // ── Boundary state ───────────────────────────────────────────────

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

    // ── Virtual monitors ─────────────────────────────────────────────

    @getter(Array)
    get virtualMonitors() {
        return [...this.#virtualMonitors];
    }

    @getter(Boolean)
    get virtualMonitorActive() {
        return this.#virtualMonitors.length > 0;
    }

    // ── Screenshot methods ───────────────────────────────────────────

    screenshot(fullscreen: boolean) {
        if (!fullscreen) {
            this.selectedMode = 'screenshot';
            this.selectedTarget = 'area';
            this.overlayOpen = true;
            return;
        }

        const dir = ensureScreenshotDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${dir}/${timestamp}.png`;

        Process.execAsync(`${GRIM_BIN} "${filename}"`)
            .then(() => {
                copyImageToClipboard(filename);
                notify(
                    'Screenshot saved',
                    filename,
                    'camera-photo-symbolic'
                );
            })
            .catch(e => logger.error('screenshot', 'grim failed:', e))
            .finally(() => this.stopFreeze());
    }

    // ── Recording methods ────────────────────────────────────────────

    toggleRecording() {
        if (this.#recording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    #resolveRecordingFilename(ext: string): string {
        GLib.mkdir_with_parents(RECORDING_DIR, 0o755);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${RECORDING_DIR}/${timestamp}.${ext}`;
    }

    #resolveEffectiveOutput(options: {geometry?: string; output?: string}): string | undefined {
        return options.output ??
            (options.geometry ? undefined : AstalHyprland.get_default().focused_monitor?.name);
    }

    #spawnRecorder(args: string[], backendName: string): Process | null {
        try {
            return Process.subprocessv(args);
        } catch (e) {
            logger.error('screenshot', `failed to spawn ${backendName}: ${(e as Error).message}`);
            notify(MSG_RECORDING_FAILED, `Could not start ${backendName}: ${(e as Error).message}`, ICON_ERROR);
            return null;
        }
    }

    #initRecordingState(
        proc: Process,
        filename: string,
        backendName: string,
        forceBackend: RecorderBackend | undefined,
    ) {
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
    }

    #startDurationTimer() {
        this.#durationTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#recordingElapsed = Math.floor((Date.now() - this.#recordingStartTime) / 1000);
            this.notify('recording-elapsed');
            return this.#recording;
        });
    }

    #showRecordingBoundary(geometry: string) {
        const [pos, size] = geometry.split(' ');
        const [x, y] = pos!.split(',').map(Number);
        const [w, h] = size!.split('x').map(Number);
        this.showBoundary({x, y, width: w, height: h});
    }

    #onRecordingExit(
        proc: Process,
        options: {geometry?: string; output?: string},
        backend: RecorderBackend,
        pref: RecorderBackend,
    ) {
        const durationMs = Date.now() - this.#recordingStartTime;
        const durationStr = formatDuration(durationMs);
        const success = this.#stopRequested || durationMs >= 1000;
        const name = this.#recordingBackendName || '';

        if (!success && !this.#recordingIsRetry && backend === RecorderBackend.WL_SCREENREC && pref === RecorderBackend.AUTO) {
            logger.warn('screenshot', `${name} exited after ${durationMs}ms; retrying with wf-recorder`);
            this.#resetRecordingProcess();
            this.startRecording(options, RecorderBackend.WF_RECORDER);
            return;
        }

        logger.info('screenshot', `${name} exited after ${durationStr} (${durationMs}ms)`);

        if (success) {
            notify('Recording stopped', `Duration: ${durationStr}\nSaved to: ${this.#recordingFile}`, 'media-playback-stop-symbolic');
        } else {
            notify(MSG_RECORDING_FAILED, `${name} exited immediately (${durationMs}ms). Check geometry/output and that no other recorder is running.`, ICON_ERROR);
        }

        this.#resetRecordingProcess();
        this.notify('recording');
        this.notify('recording-elapsed');
    }

    startRecording(
        options: {geometry?: string; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        if (this.#recording) return;

        const settings = getScreenCaptureSettings();
        const pref = forceBackend ?? (settings.recorderBackend() as RecorderBackend);
        const backend = resolveBackend(pref);
        const format = settings.recordingFormat() as RecordingFormat;
        const ext = format === RecordingFormat.WEBM ? 'webm' : 'mp4';

        const filename = this.#resolveRecordingFilename(ext);
        const effectiveOutput = this.#resolveEffectiveOutput(options);

        const {args, backendName} = buildRecordingArgs(
            backend, filename, options.geometry, effectiveOutput,
            this.#audio, format, this.#selectedAudioInput, this.#recordingQuality,
        );

        logger.info('screenshot', `starting ${backendName} with args: ${args.join(' ')}`);

        const proc = this.#spawnRecorder(args, backendName);
        if (!proc) return;

        this.#initRecordingState(proc, filename, backendName, forceBackend);
        this.#startDurationTimer();

        notify('Recording started', filename, 'media-record-symbolic');

        if (options.geometry) this.#showRecordingBoundary(options.geometry);

        proc.connect('exit', () => this.#onRecordingExit(proc, options, backend, pref));
    }

    #resetRecordingProcess() {
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

    recordArea() {
        if (this.#recording) return;
        this.openRegionSelectorForCapture('recording');
    }

    recordOutput(outputName?: string) {
        if (this.#recording) return;
        if (!outputName) {
            const hyprland = AstalHyprland.get_default();
            outputName = hyprland.focused_monitor?.name;
            logger.info('screenshot', `focused monitor name: ${outputName}`);
        }
        if (!outputName) {
            logger.error('screenshot', 'no output name, cannot record output');
            notify(
                MSG_RECORDING_FAILED,
                'No monitor found',
                ICON_ERROR
            );
            return;
        }
        this.startRecording({output: outputName});
    }

    recordOutputVisual() {
        if (this.#recording) return;
        this.selectedMode = 'recording';
        this.selectedTarget = 'monitor';
        this.overlayOpen = true;
    }

    recordWindowVisual() {
        if (this.#recording) return;
        this.selectedMode = 'recording';
        this.selectedTarget = 'window';
        this.overlayOpen = true;
    }

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
            notify(
                MSG_RECORDING_FAILED,
                'Window not found',
                ICON_ERROR
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
            notify(
                MSG_RECORDING_FAILED,
                'No window focused',
                ICON_ERROR
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

    setFreezeKeepAlive(v: boolean) {
        this.#freezeKeepAlive = v;
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
                notify(
                    'Virtual monitor',
                    'Hyprland did not register the headless output.',
                    ICON_ERROR
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
            notify(
                'Virtual monitor',
                `Could not create virtual monitor: ${(e as Error).message}`,
                ICON_ERROR
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

    /** Register GAction commands for screenshot/recording. */
    registerCommands(app: Gio.Application) {
        const actions: Record<string, () => void> = {
            screenshot: () => this.screenshot(true),
            'screenshot-area': () => this.screenshot(false),
            'screenshot-overlay': () => this.toggleOverlay(),
            record: () => this.toggleRecording(),
            'record-area': () => this.recordArea(),
            'record-window': () => this.recordWindow(),
            'record-output': () => this.recordOutput(),
        };
        for (const [name, fn] of Object.entries(actions)) {
            const action = Gio.SimpleAction.new(name, null);
            action.connect('activate', fn);
            app.add_action(action);
        }

        // record-window-address takes a string parameter (window address)
        const addressAction = Gio.SimpleAction.new(
            'record-window-address',
            GLib.VariantType.new('s')
        );
        addressAction.connect('activate', (_action, param) => {
            const address = param?.get_string()[0];
            if (address) this.recordWindowByAddress(address);
        });
        app.add_action(addressAction);
    }

    dispose() {
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