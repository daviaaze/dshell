import GLib from 'gi://GLib?version=2.0';
import {Accessor, createState} from 'gnim';

/**
 * Shared 1Hz wall-clock tick.
 *
 * Event-driven: a single GLib.timeout source for the whole shell; widgets
 * bind to `time` instead of each registering their own polling timer.
 */
export default class Clock {
    static instance: Clock;

    static get_default(): Clock {
        if (!this.instance) this.instance = new Clock();
        return this.instance;
    }

    #time: Accessor<GLib.DateTime>;
    #setTime: (v: GLib.DateTime) => void;

    constructor() {
        const [time, setTime] = createState(GLib.DateTime.new_now_local());
        this.#time = time;
        this.#setTime = setTime;

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this.#setTime(GLib.DateTime.new_now_local());
            return GLib.SOURCE_CONTINUE;
        });
    }

    get time(): Accessor<GLib.DateTime> {
        return this.#time;
    }
}
