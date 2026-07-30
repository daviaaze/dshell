/** Capture domain events — screenshot and screen recording. */
export interface CaptureEvents {
    'capture:screenshot': boolean; // fullScreen
    'capture:screenshot:area': void;
    'capture:screenshot:overlay': void;
    'capture:record': void;
    'capture:record:area': void;
    'capture:record:window': void;
    'capture:record:window:address': string;
    'capture:record:output': void;
}
