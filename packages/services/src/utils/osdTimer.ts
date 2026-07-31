/**
 * OsdTimer — debounced "OSD visible" flag for domain services.
 *
 * Each domain service that has an on-screen display (AudioController,
 * Brightness, Touchpad, …) owns one OsdTimer per popup and exposes the
 * state as a reactive @property so any widget (osd, bar, quicksettings)
 * can bind to the same source.
 *
 * Behavior (per docs/specs/osd.md):
 *   - trigger() reveals for `timeoutMs`, then auto-hides
 *   - retriggering within the window resets the timer (full timeout from
 *     the last signal — e.g. scroll-wheel volume changes)
 */
export default class OsdTimer {
    #visible = false;
    #timeout: ReturnType<typeof setTimeout> | null = null;

    /**
     * @param onChange called whenever the flag flips; services use it to
     *   `notify()` the backing GObject property (kebab-case name).
     * @param timeoutMs reveal duration, default 2000ms.
     */
    constructor(
        private onChange: (visible: boolean) => void,
        private timeoutMs = 2000
    ) {}

    get visible(): boolean {
        return this.#visible;
    }

    trigger(): void {
        this.#set(true);
        if (this.#timeout) clearTimeout(this.#timeout);
        this.#timeout = setTimeout(() => {
            this.#timeout = null;
            this.#set(false);
        }, this.timeoutMs);
    }

    dispose(): void {
        if (this.#timeout) clearTimeout(this.#timeout);
        this.#timeout = null;
        this.#set(false);
    }

    #set(v: boolean): void {
        if (this.#visible === v) return;
        this.#visible = v;
        this.onChange(v);
    }
}
