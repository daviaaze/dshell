/**
 * ── Types and enums for capture (screenshot/recording) services ──
 */

export type CaptureMode = 'screenshot' | 'recording';
export type CaptureTarget = 'fullscreen' | 'area' | 'window' | 'monitor';

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

export interface MonitorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LineSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** Axis-aligned bounding box overlap test. */
export function rectOverlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number
): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Clamp a boundary rect to a monitor's coordinate space and return the
 * visible edge segments. Pure geometry — no Cairo, no GI types — so it
 * belongs in the service layer, not the rendering widget.
 */
export function visibleBoundaryEdges(
    rect: BoundaryGeometry,
    monitor: MonitorRect
): LineSegment[] {
    const left = Math.max(rect.x, monitor.x);
    const top = Math.max(rect.y, monitor.y);
    const right = Math.min(rect.x + rect.width, monitor.x + monitor.width);
    const bottom = Math.min(rect.y + rect.height, monitor.y + monitor.height);
    if (right <= left || bottom <= top) return [];

    const edges: LineSegment[] = [];
    if (rect.y >= monitor.y && rect.y <= monitor.y + monitor.height) {
        edges.push({x1: left - monitor.x, y1: rect.y - monitor.y, x2: right - monitor.x, y2: rect.y - monitor.y});
    }
    if (rect.y + rect.height >= monitor.y && rect.y + rect.height <= monitor.y + monitor.height) {
        edges.push({x1: left - monitor.x, y1: rect.y + rect.height - monitor.y, x2: right - monitor.x, y2: rect.y + rect.height - monitor.y});
    }
    if (rect.x >= monitor.x && rect.x <= monitor.x + monitor.width) {
        edges.push({x1: rect.x - monitor.x, y1: top - monitor.y, x2: rect.x - monitor.x, y2: bottom - monitor.y});
    }
    if (rect.x + rect.width >= monitor.x && rect.x + rect.width <= monitor.x + monitor.width) {
        edges.push({x1: rect.x + rect.width - monitor.x, y1: top - monitor.y, x2: rect.x + rect.width - monitor.x, y2: bottom - monitor.y});
    }
    return edges;
}
export interface ScreenshotHandle {
    // ── Bindable properties ──
    selectedMode: CaptureMode;
    selectedTarget: CaptureTarget;
    overlayOpen: boolean;
    /** Quick-select mode: minimal UI, click/Enter confirms immediately. */
    overlayQuick: boolean;
    recording: boolean;
    stageHasFrame: boolean;
    captureBusy: boolean;
    captureResult: string;
    captureError: string;
    clearCaptureFeedback(): void;
    // ── Methods ──
    screenshot(fullscreen: boolean): void;
    toggleOverlay(): void;
    toggleRecording(): void;
    captureFromStage(geometry: BoundaryGeometry | null): Promise<void>;
    startRecording(
        options?: {geometry?: BoundaryGeometry; output?: string},
        forceBackend?: RecorderBackend
    ): void;
    recordArea(): void;
    recordWindow(): void;
    recordOutput(outputName?: string): void;
    recordWindowByAddress(address: string): void;
}
