import type Gdk from 'gi://Gdk?version=4.0';
import type Gio from 'gi://Gio?version=2.0';
import {property} from '@shade/core/decorators';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Object, register} from 'gnim/gobject';
import {
    confirmArea as confirmAreaFlow,
    screenshotFullscreen,
    startRecordingAfterOverlayClose,
} from './captureFlow';
import {registerCommands} from './commands';
import RecordingPrefs from './prefs';
import {Recorder} from './recorder';
import {
    recordArea,
    recordOutput,
    recordOutputVisual,
    recordWindow,
    recordWindowByAddress,
    recordWindowVisual,
} from './recordTargets';
import {Stage} from './stage';
import type {
    BoundaryGeometry,
    CaptureMode,
    CaptureTarget,
    RecorderBackend,
    VirtualMonitor,
} from './types';
import {createVirtualMonitor, removeVirtualMonitors} from './virtualMonitors';

export type {BoundaryGeometry, VirtualMonitor} from './types';
export {RecorderBackend, RecordingFormat} from './types';

/**
 * Screen capture service — GObject facade that owns all bindable state and
 * delegates work to focused collaborators:
 * - `recorder.ts`        recording pipeline (process lifecycle, backends)
 * - `stage.ts`           frozen-frame capture/crop (single freeze mechanism)
 * - `captureFlow.ts`     fullscreen/confirm capture flows
 * - `recordTargets.ts`   "record area/output/window" entry points
 * - `geometry.ts`        typed geometry parsing/conversion
 * - `virtualMonitors.ts` headless output management
 * - `commands.ts`        GAction registration
 *
 * Geometry is typed (`BoundaryGeometry`) across the whole domain; grim and
 * magick strings are produced only at process boundaries.
 */
@register
export default class Screenshot extends Object {
    private static instance: Screenshot | undefined;

    static get_default() {
        if (!Screenshot.instance) {
            Screenshot.instance = new Screenshot();
        }
        return Screenshot.instance;
    }

    #recorder = new Recorder({
        getAudioSettings: () => this.#prefs.snapshot(),
        showBoundary: (geometry) => this.showBoundary(geometry),
        hideBoundary: () => this.hideBoundary(),
        notifyState: () => {
            this.notify('recording');
            this.notify('recording-elapsed');
        },
    });

    #stage = new Stage(() => this.notify('stage-texture'));

    #prefs = new RecordingPrefs();

    // ── Overlay state ────────────────────────────────────────────
    #overlayOpen = false;
    #overlayQuick = false;
    #selectedMode: CaptureMode = 'screenshot';
    #selectedTarget: CaptureTarget = 'fullscreen';

    #boundaryVisible = false;
    #boundaryGeometry: BoundaryGeometry | null = null;
    #virtualMonitors: VirtualMonitor[] = [];

    // ── Recording ────────────────────────────────────────────────

    @property
    get recordingElapsed() {
        return this.#recorder.elapsed;
    }

    @property
    get recording() {
        return this.#recorder.recording;
    }

    @property
    get prefs(): RecordingPrefs {
        return this.#prefs;
    }

    // ── Overlay state ─────────────────────────────────────────────

    @property
    get overlayOpen() {
        return this.#overlayOpen;
    }

    set overlayOpen(v: boolean) {
        if (this.#overlayOpen === v) return;

        if (v) {
            this.#stage.captureSync();
            if (!this.#stage.pixPath) {
                logger.warn('screenshot', 'stage capture failed, overlay will show live screen');
            }
        }

        this.#overlayOpen = v;
        this.notify('overlay-open');

        if (!v) {
            this.#stage.cleanup();
            this.#overlayQuick = false;
        }
    }

    /**
     * Quick-select mode (replaces the old region-selector): minimal UI —
     * no control panel, click/Enter confirms immediately.
     */
    @property
    get overlayQuick() {
        return this.#overlayQuick;
    }

    set overlayQuick(v: boolean) {
        if (this.#overlayQuick === v) return;
        this.#overlayQuick = v;
        this.notify('overlay-quick');
    }

    @property
    get selectedMode() {
        return this.#selectedMode;
    }

    set selectedMode(v: CaptureMode) {
        this.#selectedMode = v;
        this.notify('selected-mode');
    }

    @property
    get selectedTarget() {
        return this.#selectedTarget;
    }

    set selectedTarget(v: CaptureTarget) {
        this.#selectedTarget = v;
        this.notify('selected-target');
    }

    /** @internal — used by captureFlow */
    get stageHasFrame(): boolean {
        return this.#stage.pixPath !== null;
    }

    // ── Stage ─────────────────────────────────────────────────────

    @property
    get stageTexture(): Gdk.Texture | null {
        return this.#stage.texture;
    }

    // ── Boundary ───────────────────────────────────────────────────────

    @property
    get boundaryVisible() {
        return this.#boundaryVisible;
    }

    set boundaryVisible(v: boolean) {
        if (this.#boundaryVisible === v) return;
        this.#boundaryVisible = v;
        this.notify('boundary-visible');
    }

    @property
    get boundaryGeometry() {
        return this.#boundaryGeometry;
    }

    set boundaryGeometry(v: BoundaryGeometry | null) {
        this.#boundaryGeometry = v;
        this.notify('boundary-geometry');
    }

    // ── Virtual monitors ──────────────────────────────────────────────

    @property
    get virtualMonitors() {
        return this.#virtualMonitors;
    }

    @property
    get virtualMonitorActive() {
        return this.#virtualMonitors.length > 0;
    }

    // ── Capture flows ──────────────────────────────────────────────────

    /** Fullscreen grim capture (button/CLI path). */
    screenshot(fullscreen: boolean) {
        if (!fullscreen) {
            this.#selectedMode = 'screenshot';
            this.#selectedTarget = 'area';
            this.notify('selected-mode');
            this.notify('selected-target');
            this.overlayOpen = true;
            return;
        }
        screenshotFullscreen();
    }

    /**
     * Quick-select confirm: the user picked an area in the unified overlay.
     * Screenshots crop the frozen stage; recordings start after close.
     */
    confirmArea(geometry: BoundaryGeometry) {
        confirmAreaFlow(this, geometry);
    }

    /**
     * Overlay panel confirm: crop from the stage (screenshot) or close the
     * overlay and start recording. `geometry` is null for fullscreen.
     */
    confirmOverlay(
        target: 'fullscreen' | 'area' | 'window' | 'monitor',
        geometry: BoundaryGeometry | null
    ) {
        if (this.#selectedMode === 'screenshot') {
            this.captureFromStage(geometry);
        } else {
            startRecordingAfterOverlayClose(this, geometry);
        }
    }

    async captureFromStage(geometry: BoundaryGeometry | null) {
        const ok = await this.#stage.captureCrop(geometry);
        if (ok) this.overlayOpen = false;
    }

    // ── Recording ──────────────────────────────────────────────────────

    toggleRecording() {
        this.#recorder.toggle();
    }

    startRecording(
        options: {geometry?: BoundaryGeometry; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        this.#recorder.start(options, forceBackend);
    }

    stopRecording() {
        this.#recorder.stop();
    }

    recordArea() {
        recordArea(this);
    }

    recordOutput(outputName?: string) {
        recordOutput(this, outputName);
    }

    recordOutputVisual() {
        recordOutputVisual(this);
    }

    recordWindowVisual() {
        recordWindowVisual(this);
    }

    recordWindowByAddress(address: string) {
        recordWindowByAddress(this, address);
    }

    recordWindow() {
        recordWindow(this);
    }

    // ── Overlay ────────────────────────────────────────────────────────

    toggleOverlay() {
        this.overlayOpen = !this.#overlayOpen;
    }
    showOverlay() {
        this.overlayOpen = true;
    }
    hideOverlay() {
        this.overlayOpen = false;
    }

    // ── Recording boundary ─────────────────────────────────────────────

    showBoundary(geometry: BoundaryGeometry) {
        this.boundaryGeometry = geometry;
        this.boundaryVisible = true;
    }

    hideBoundary() {
        this.boundaryVisible = false;
        this.boundaryGeometry = null;
    }

    // ── Virtual monitors ──────────────────────────────────────────────

    async createVirtualMonitor(resolution = '1920x1080', fps = 60): Promise<VirtualMonitor | null> {
        const vm = await createVirtualMonitor(this.#virtualMonitors, resolution, fps);
        if (vm) {
            this.notify('virtual-monitors');
            this.notify('virtual-monitor-active');
        }
        return vm;
    }

    removeVirtualMonitors() {
        removeVirtualMonitors(this.#virtualMonitors);
        this.notify('virtual-monitors');
        this.notify('virtual-monitor-active');
    }

    /** Register GAction commands for screenshot/recording. */
    registerCommands(app: Gio.Application) {
        registerCommands(this, app);
    }

    dispose() {
        this.#recorder.dispose();
        this.#stage.cleanup();
    }
}

defineService({name: 'Screenshot', service: Screenshot.get_default()});
