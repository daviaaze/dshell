/**
 * Timer Events — countdown and pomodoro timer lifecycle.
 *
 * Commands emitted by widgets and consumed by TimerService.
 */
export interface TimeEvents {
    'timer:cmd:start-countdown': number; // durationMs
    'timer:cmd:start-pomodoro': void;
    'timer:cmd:pause': void;
    'timer:cmd:resume': void;
    'timer:cmd:cancel': void;
}
