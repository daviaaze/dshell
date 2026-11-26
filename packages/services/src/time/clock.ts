import GLib from 'gi://GLib?version=2.0';
import {type Accessor, createState} from 'gnim';
import logger from '@shade/core/logger';

/**
 * Shared wall-clock state.
 *
 * Two time sources:
 *   - `time`: 1Hz tick, used by displays that show seconds (timers, lockscreen, world clock).
 *   - `wallTime`: updates only when the minute changes, used by the wall-clock display (no seconds).
 *
 * A single GLib.timeout source drives both, so `wallTime` changes within a second of the
 * minute boundary (also right after resume from suspend); widgets bind to whichever
 * accessor they need instead of each registering their own poll.
 */
export default class Clock {
    private static instance: Clock;

    static get_default(): Clock {
        if (!Clock.instance) Clock.instance = new Clock();
        return Clock.instance;
    }

    #time: Accessor<GLib.DateTime>;
    #setTime: (v: GLib.DateTime) => void;
    #wallTime: Accessor<GLib.DateTime>;
    #setWallTime: (v: GLib.DateTime) => void;
    #tickTimer: number | null = null;

    constructor() {
        const now = GLib.DateTime.new_now_local()!;
        const [time, setTime] = createState(now);
        this.#time = time;
        this.#setTime = setTime;

        const [wallTime, setWallTime] = createState(now);
        this.#wallTime = wallTime;
        this.#setWallTime = setWallTime;

        this.#tickTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            try {
                const tick = GLib.DateTime.new_now_local()!;
                this.#setTime(tick);
                if (
                    Math.floor(tick.to_unix() / 60) !== Math.floor(this.#wallTime().to_unix() / 60)
                ) {
                    this.#setWallTime(tick);
                }
            } catch (e) {
                logger.error('clock', '1Hz tick failed:', e);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** 1Hz tick — timer / countdown / seconds displays. */
    get time(): Accessor<GLib.DateTime> {
        return this.#time;
    }

    /** Changes when the minute changes — wall clock display (no seconds). */
    get wallTime(): Accessor<GLib.DateTime> {
        return this.#wallTime;
    }
}
