/** Capture domain events — screenshot and screen recording. */
export interface CaptureEvents {
    // ── Notification events (emitted by services on completion) ──
    'capture:screenshot': boolean; // fullScreen
    'capture:screenshot:area': void;
    'capture:screenshot:overlay': void;
    'capture:record': void;
    'capture:record:area': void;
    'capture:record:window': void;
    'capture:record:window:address': string;
    'capture:record:output': void;

    // ── Command events (emitted by widgets, consumed by Screenshot) ──
    'capture:cmd:screenshot': boolean; // fullScreen
    'capture:cmd:recording:stop': void;
    'capture:cmd:recording:toggle': void;
    'capture:cmd:recording:area': void;
    'capture:cmd:recording:output-visual': void;
    'capture:cmd:recording:window-visual': void;
    'capture:cmd:prefs:audio': boolean;
    'capture:cmd:virtual-monitors:create': {resolution: string; fps: number};
    'capture:cmd:virtual-monitors:remove': void;
    'capture:cmd:capture-area': string; // geometry
    'capture:cmd:region-selector:close': void;
    'capture:cmd:capture-from-stage': string | null; // geometry
    'capture:cmd:start-recording-after-overlay': { target: string; geometry?: string | null };
}
