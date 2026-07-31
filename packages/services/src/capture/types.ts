/**
 * ── Types and enums for capture (screenshot/recording) services ──
 */

export enum RecorderBackend {
    WL_SCREENREC = 0,
    WF_RECORDER = 1,
    AUTO = 2,
}

export enum RecordingFormat {
    MP4 = 0,
    WEBM = 1,
}

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

/**
 * Public API surface of the Screenshot service, consumed by helper
 * modules (captureFlow, commands, recordTargets).  Defined here as
 * an interface so helpers never import the Screenshot class directly,
 * eliminating the type-only circular dependency.
 */
export interface ScreenshotHandle {
    // ── Bindable properties ──
    selectedMode: 'screenshot' | 'recording';
    selectedTarget: 'fullscreen' | 'area' | 'window' | 'monitor';
    overlayOpen: boolean;
    regionSelectorOpen: boolean;
    pendingCaptureGeometry: string;
    recording: boolean;
    stageHasFrame: boolean;

    // ── Methods ──
    screenshot(fullscreen: boolean): void;
    toggleOverlay(): void;
    toggleRecording(): void;
    stopFreeze(): void;
    setFreezeCapturePending(v: boolean): void;
    captureFromStage(geometry: string | null): Promise<void>;
    startRecording(
        options?: {geometry?: string; output?: string},
        forceBackend?: RecorderBackend
    ): void;
    openRegionSelectorForCapture(mode: 'screenshot' | 'recording'): void;
    recordArea(): void;
    recordWindow(): void;
    recordOutput(outputName?: string): void;
    recordWindowByAddress(address: string): void;
}
