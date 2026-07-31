import {Timeout} from '@shade/core/timeout';

/**
 * Per-notification auto-dismiss timers with pause/resume (hover) support.
 *
 * Used by the popup toast widget: hovering a toast pauses its countdown,
 * leaving restarts it. `resume` restarts the full timeout (matches the
 * freedesktop "wake from hover" convention — the clock does not keep
 * ticking while the user is reading).
 */
export class DismissTimers {
    #timers = new Map<number, Timeout>();
    #onExpire: (id: number) => void;

    constructor(onExpire: (id: number) => void) {
        this.#onExpire = onExpire;
    }

    /** (Re)start the dismiss timer for `id`. */
    schedule(id: number, ms: number): void {
        this.cancel(id);
        const t = new Timeout();
        t.start(ms, () => {
            this.#timers.delete(id);
            this.#onExpire(id);
        });
        this.#timers.set(id, t);
    }

    /** Pause the timer for `id` (e.g. pointer entered the toast). */
    pause(id: number): void {
        this.cancel(id);
    }

    /** Restart the timer for `id` if none is pending (pointer left). */
    resume(id: number, ms: number): void {
        if (this.#timers.has(id)) return;
        this.schedule(id, ms);
    }

    /** Cancel the timer for `id` without expiring (e.g. manual dismiss). */
    cancel(id: number): void {
        const t = this.#timers.get(id);
        if (t) {
            t.cancel();
            this.#timers.delete(id);
        }
    }

    /** Cancel every pending timer (widget teardown). */
    clear(): void {
        for (const t of this.#timers.values()) t.cancel();
        this.#timers.clear();
    }

    has(id: number): boolean {
        return this.#timers.has(id);
    }

    get size(): number {
        return this.#timers.size;
    }
}
