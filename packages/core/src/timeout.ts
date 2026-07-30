import GLib from 'gi://GLib?version=2.0';

/**
 * One-shot timeout with an explicit cancel handle — for watchdogs and
 * auth-flow guards that must be cancellable from several code paths.
 *
 * Widgets should use this instead of hand-rolling GLib.timeout_add +
 * GLib.source_remove bookkeeping.
 */
export class Timeout {
    #id = 0;

    /** (Re)start the timeout. Cancels any pending callback first. */
    start(ms: number, cb: () => void): void {
        this.cancel();
        this.#id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this.#id = 0;
            cb();
            return GLib.SOURCE_REMOVE;
        });
    }

    cancel(): void {
        if (this.#id) {
            GLib.source_remove(this.#id);
            this.#id = 0;
        }
    }

    get pending(): boolean {
        return this.#id !== 0;
    }
}
