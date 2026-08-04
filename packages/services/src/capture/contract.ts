/** Capture domain events — screenshot and screen recording.
 *
 * Notification events only: emitted by the capture services when an action
 * completes, consumed by sound alerts. Widgets call Screenshot methods
 * directly — there is no command bus for this domain.
 */
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
