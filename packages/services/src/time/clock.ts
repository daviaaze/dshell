import GLib from 'gi://GLib?version=2.0';
import {type Accessor, createState} from 'gnim';

/**
 * Shared wall-clock state.
 *
 * Two time sources:
 *   - `time`: 1Hz tick, used by the active timer/countdown display only.
 *   - `wallTime`: 1-minute tick, used by the wall-clock display (no seconds).
 *
 * A single GLib.timeout source drives both; widgets bind to whichever
 * accessor they need instead of each registering their own poll.
 */
export default class Clock {
    private static instance: Clock;

    static get_default(): Clock {
        if (!Clock.instance) Clock.instance = new Clock();
        return Clock.instance;
    }

    static readonly WALL_INTERVAL_MS = 60_000;

    #time: Accessor<GLib.DateTime>;
    #setTime: (v: GLib.DateTime) => void;
    #wallTime: Accessor<GLib.DateTime>;
    #setWallTime: (v: GLib.DateTime) => void;
    #wallTimer: number | null = null;

    constructor() {
        const [time, setTime] = createState(GLib.DateTime.new_now_local()!);
        this.#time = time;
        this.#setTime = setTime;

        const [wallTime, setWallTime] = createState(GLib.DateTime.new_now_local()!);
        this.#wallTime = wallTime;
        this.#setWallTime = setWallTime;

        // 1Hz tick — powers the active timer countdown.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#setTime(GLib.DateTime.new_now_local()!);
            return GLib.SOURCE_CONTINUE;
        });

        // 1-minute tick — powers the wall clock display. The clock widget
        // is mounted for the session lifetime, so this runs continuously
        // but fires 60× less often than the 1Hz tick.
        this.#startWallTimer();
    }

    /** 1Hz tick — active timer / countdown display. */
    get time(): Accessor<GLib.DateTime> {
        return this.#time;
    }

    /** 1-minute tick — wall clock display (no seconds). */
    get wallTime(): Accessor<GLib.DateTime> {
        return this.#wallTime;
    }

    #startWallTimer(): void {
        if (this.#wallTimer !== null) return;
        this.#wallTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Clock.WALL_INTERVAL_MS, () => {
            this.#setWallTime(GLib.DateTime.new_now_local()!);
            return GLib.SOURCE_CONTINUE;
        });
    }
}
