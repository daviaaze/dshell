import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import {Object, register} from 'gnim/gobject';
import {defineService} from '@shade/core/define';
import {property} from '@shade/core/decorators';
import {bus} from '../bus';
import logger from '@shade/core/logger';
import {
    RecorderBackend,
    type VirtualMonitor,
    type BoundaryGeometry,
} from './types';
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
import {createVirtualMonitor, removeVirtualMonitors} from './virtualMonitors';

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
@register
export default class Screenshot extends Object {
    private static instance: Screenshot | undefined;

    static get_default() {
        if (!this.instance) {
            this.instance = new Screenshot();
            this.instance.#initBus();
        }
        return this.instance;
    }

    #busSubscriptions: (() => void)[] = [];

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

    // ── Overlay state ─────────────────────────────────────────────────

    @property
    get overlayOpen() {
        return this.#overlayOpen;
    }

    set overlayOpen(v: boolean) {
        if (this.#overlayOpen === v) return;

        if (v) {
            this.#stage.captureSync();
            if (!this.#stage.pixPath) {
                logger.warn(
                    'screenshot',
                    'stage capture failed, overlay will show live screen'
                );
            }
        }

        this.#overlayOpen = v;
        this.notify('overlay-open');

        if (!v) {
            this.#stage.cleanup();
        }
    }

    @property
    get selectedMode() {
        return this.#selectedMode;
    }

    set selectedMode(v: 'screenshot' | 'recording') {
        this.#selectedMode = v;
        this.notify('selected-mode');
    }

    @property
    get selectedTarget() {
        return this.#selectedTarget;
    }

    set selectedTarget(v: 'fullscreen' | 'area' | 'window' | 'monitor') {
        this.#selectedTarget = v;
        this.notify('selected-target');
    }

    // ── Region selector ───────────────────────────────────────────────

    @property
    get regionSelectorOpen() {
        return this.#regionSelectorOpen;
    }

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

    @property
    get pendingCaptureGeometry(): string {
        return this.#pendingCaptureGeometry || '';
    }

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

    @property
    get stageTexture(): Gdk.Texture | null {
        return this.#stage.texture;
    }

    @property
    get freezeActive() {
        return this.#freezeActive;
    }

    set freezeActive(v: boolean) {
        if (this.#freezeActive === v) return;
        this.#freezeActive = v;
        this.notify('freeze-active');
    }

    @property
    get freezeKeepAlive() {
        return this.#freezeKeepAlive;
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

    toggleRecording() {
        this.#recorder.toggle();
    }

    startRecording(
        options: {geometry?: string; output?: string} = {},
        forceBackend?: RecorderBackend
    ) {
        this.#recorder.start(options, forceBackend);
    }

    stopRecording() {
        this.#recorder.stop();
    }

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
    startFreeze() {
        this.#freeze.start();
    }
    stopFreeze() {
        this.#freeze.stop();
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

    async createVirtualMonitor(
        resolution = '1920x1080',
        fps = 60
    ): Promise<VirtualMonitor | null> {
        const vm = await createVirtualMonitor(
            this.#virtualMonitors,
            resolution,
            fps
        );
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

    #initBus() {
        if (this.#busSubscriptions.length > 0) return;
        this.#busSubscriptions.push(
            bus.on('capture:cmd:screenshot', fullScreen => this.screenshot(fullScreen))
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:recording:stop', () => this.stopRecording())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:recording:toggle', () => this.toggleRecording())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:recording:area', () => this.recordArea())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:recording:output-visual', () => this.recordOutputVisual())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:recording:window-visual', () => this.recordWindowVisual())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:prefs:audio', v => { this.prefs.audio = v; })
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:virtual-monitors:remove', () => this.removeVirtualMonitors())
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:virtual-monitors:create', ({resolution, fps}) => this.createVirtualMonitor(resolution, fps))
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:capture-area', geometry => this.captureArea(geometry))
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:region-selector:close', () => { this.regionSelectorOpen = false; })
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:capture-from-stage', geometry => this.captureFromStage(geometry))
        );
        this.#busSubscriptions.push(
            bus.on('capture:cmd:start-recording-after-overlay', ({target, geometry}) => this.startRecordingAfterOverlayClose(target, geometry))
        );
    }

    dispose() {
        this.#freeze.stop();
        this.#recorder.dispose();
    }
}

defineService({name: 'Screenshot', service: Screenshot.get_default()});
