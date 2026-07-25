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
