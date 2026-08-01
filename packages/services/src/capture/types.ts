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
    bh: number,
): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Clamp a boundary rect to a monitor's coordinate space and return the
 * visible edge segments. Pure geometry — no Cairo, no GI types — so it
 * belongs in the service layer, not the rendering widget.
 */
export function visibleBoundaryEdges(
    geom: BoundaryGeometry,
    monitor: MonitorRect,
): LineSegment[] {
    const {x: mx, y: my, width: mw, height: mh} = monitor;
    if (!rectOverlap(geom.x, geom.y, geom.width, geom.height, mx, my, mw, mh)) {
        return [];
    }
    const localX = geom.x - mx;
    const localY = geom.y - my;
    const localW = geom.width;
    const localH = geom.height;
    const edges: LineSegment[] = [];
    // Top
    if (localY >= 0 && localY < mh) {
        edges.push({
            x1: Math.max(0, localX),
            y1: localY,
            x2: Math.min(mw, localX + localW),
            y2: localY,
        });
    }
    // Bottom
    if (localY + localH >= 0 && localY + localH < mh) {
        edges.push({
            x1: Math.max(0, localX),
            y1: localY + localH,
            x2: Math.min(mw, localX + localW),
            y2: localY + localH,
        });
    }
    // Left
    if (localX >= 0 && localX < mw) {
        edges.push({
            x1: localX,
            y1: Math.max(0, localY),
            x2: localX,
            y2: Math.min(mh, localY + localH),
        });
    }
    // Right
    if (localX + localW >= 0 && localX + localW < mw) {
        edges.push({
            x1: localX + localW,
            y1: Math.max(0, localY),
            x2: localX + localW,
            y2: Math.min(mh, localY + localH),
        });
    }
    return edges;
}

/** Parse "#rrggbb" → normalized RGBA (alpha is a rendering concern, left at 1). */
export function parseColor(hex: string): {r: number; g: number; b: number; a: number} {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16) / 255,
        g: parseInt(h.substring(2, 4), 16) / 255,
        b: parseInt(h.substring(4, 6), 16) / 255,
        a: 1.0,
    };
}

/**
 * Public API surface of the Screenshot service, consumed by helper
 * modules (captureFlow, commands, recordTargets).  Defined here as
 * an interface so helpers never import the Screenshot class directly,
 * eliminating the type-only circular dependency.
 *
 * Geometry is typed (`BoundaryGeometry`) end-to-end; grim/magick strings
 * exist only at process boundaries (see geometry.ts).
 */
export interface ScreenshotHandle {
    // ── Bindable properties ──
    selectedMode: CaptureMode;
    selectedTarget: CaptureTarget;
    overlayOpen: boolean;
    /** Quick-select mode: minimal UI, confirm-on-click (was region-selector). */
    overlayQuick: boolean;
    recording: boolean;
    stageHasFrame: boolean;

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
