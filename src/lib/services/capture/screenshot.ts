import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject, {register} from 'gnim/gobject';
import {getter, setter} from '#/lib/decorators';
import logger from '#/lib/core/logger';
import {RecorderBackend, RecordingFormat, type VirtualMonitor, type BoundaryGeometry} from './types';
import {Recorder} from './recorder';
import RecordingPrefs from './prefs';
import {Freeze} from './freeze';
import {Stage} from './stage';
import {
    screenshot,
    captureGeometry,
    openRegionSelectorForCapture,
    captureArea,
    startRecordingAfterOverlayClose,
} from './captureFlow';
import {registerCommands} from './commands';
import {
    recordArea,
    recordOutput,
    recordOutputVisual,
    recordWindowVisual,
    recordWindowByAddress,
    recordWindow,
} from './recordTargets';
import {
    createVirtualMonitor,
    removeVirtualMonitors,
} from './virtualMonitors';

export {RecorderBackend, RecordingFormat} from './types';
export type {VirtualMonitor, BoundaryGeometry} from './types';

/**
 * Screen capture service — GObject facade that owns all bindable state and
 * delegates work to focused collaborators:
 * - `recorder.ts`        recording pipeline (process lifecycle, backends)
 * - `stage.ts`           frozen-frame capture/crop
 * - `freeze.ts`          wayfreeze process
 * - `captureFlow.ts`     screenshot/region-selector confirm flows
 * - `recordTargets.ts`   "record area/output/window" entry points
 * - `virtualMonitors.ts` headless output management
 * - `commands.ts`        GAction registration
 */
@register({GTypeName: 'Screenshot'})
export default class Screenshot extends GObject.Object {
    static instance: Screenshot;

    static get_default() {
        if (!this.instance) this.instance = new Screenshot();
        return this.instance;
    }

    #recorder = new Recorder({
        getAudioSettings: () => this.#prefs.snapshot(),
        showBoundary: geometry => {
            const [pos, size] = geometry.split(' ');
            const [x, y] = pos!.split(',').map(Number);
            const [w, h] = size!.split('x').map(Number);
            this.showBoundary({x, y, width: w, height: h});
        },
        hideBoundary: () => this.hideBoundary(),
        notifyState: () => {
            this.notify('recording');
            this.notify('recording-elapsed');
        },
    });

    #freeze = new Freeze(active => {
        this.freezeActive = active;
    });

    #stage = new Stage(() => this.notify('stage-texture'));

    #prefs = new RecordingPrefs();

    // ── Overlay state ────────────────────────────────────────────────
    #overlayOpen = false;
    #selectedMode: 'screenshot' | 'recording' = 'screenshot';
    #selectedTarget: 'fullscreen' | 'area' | 'window' | 'monitor' =
        'fullscreen';
    #regionSelectorOpen = false;
    #pendingCaptureGeometry: string | null = null;

    #freezeActive = false;
    // prevent regionSelectorOpen setter from unfreezing when selector closes on confirm
    #freezeCapturePending = false;
    #freezeKeepAlive = false;

    #boundaryVisible = false;
    #boundaryGeometry: BoundaryGeometry | null = null;
    #virtualMonitors: VirtualMonitor[] = [];

    // ── Getters / Setters ────────────────────────────────────────────

    @getter(Number)
    get recordingElapsed() {
        return this.#recorder.elapsed;
    }

    @getter(Boolean)
    get recording() {
        return this.#recorder.recording;
    }

    @getter(GObject.Object)
    get prefs(): RecordingPrefs {
        return this.#prefs;
    }

    // ── Overlay state ─────────────────────────────────────────────────

    @getter(Boolean)
    get overlayOpen() {
        return this.#overlayOpen;
    }

    @setter(Boolean)
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

    // ── Region selector ───────────────────────────────────────────────

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
    get pendingCaptureGeometry(): string {
        return this.#pendingCaptureGeometry || '';
    }

    @setter(String)
    set pendingCaptureGeometry(v: string | null) {
        this.#pendingCaptureGeometry = v;
        this.notify('pending-capture-geometry');
    }

    /** @internal — used by captureFlow */
    get stageHasFrame(): boolean {
        return this.#stage.pixPath !== null;
    }

    /** @internal — used by captureFlow */
    setFreezeCapturePending(v: boolean) {
        this.#freezeCapturePending = v;
    }

    // ── Stage / freeze ────────────────────────────────────────────────

    @getter(GObject.Object)
    get stageTexture(): Gdk.Texture | null {
        return this.#stage.texture;
    }

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

    @getter(Boolean)
    get freezeKeepAlive() {
        return this.#freezeKeepAlive;
    }

    // ── Boundary ───────────────────────────────────────────────────────

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
        return this.#virtualMonitors;
    }

    @getter(Boolean)
    get virtualMonitorActive() {
        return this.#virtualMonitors.length > 0;
    }

    // ── Capture flows ──────────────────────────────────────────────────

    screenshot(fullscreen: boolean) {
        screenshot(this, fullscreen);
    }

    /** Open the region-selector to pick an area for capture */
    openRegionSelectorForCapture(mode: 'screenshot' | 'recording') {
        openRegionSelectorForCapture(this, mode);
    }

    /** Called by region-selector when the user confirms a selection */
    captureArea(geometry: string) {
        captureArea(this, geometry);
    }

    async captureFromStage(geometry: string | null) {
        const ok = await this.#stage.captureCrop(geometry);
        if (ok) this.overlayOpen = false;
    }

    screenshotGeometry(geometry: string) {
        captureGeometry(this, geometry);
    }

    // ── Recording ──────────────────────────────────────────────────────

    toggleRecording() { this.#recorder.toggle(); }

    startRecording(
        options: {geometry?: string; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        this.#recorder.start(options, forceBackend);
    }

    stopRecording() { this.#recorder.stop(); }

    startRecordingAfterOverlayClose(target: string, geometry?: string | null) {
        startRecordingAfterOverlayClose(this, target, geometry);
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

    // ── Overlay & freeze ───────────────────────────────────────────────

    toggleOverlay() { this.overlayOpen = !this.#overlayOpen; }
    showOverlay() { this.overlayOpen = true; }
    hideOverlay() { this.overlayOpen = false; }
    setFreezeKeepAlive(v: boolean) { this.#freezeKeepAlive = v; }
    startFreeze() { this.#freeze.start(); }
    stopFreeze() { this.#freeze.stop(); }

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
        if (vm) { this.notify('virtual-monitors'); this.notify('virtual-monitor-active'); }
        return vm;
    }

    removeVirtualMonitors() {
        removeVirtualMonitors(this.#virtualMonitors);
        this.notify('virtual-monitors'); this.notify('virtual-monitor-active');
    }

    /** Register GAction commands for screenshot/recording. */
    registerCommands(app: Gio.Application) {
        registerCommands(this, app);
    }

    dispose() {
        this.#freeze.stop();
        this.#recorder.dispose();
    }
}
