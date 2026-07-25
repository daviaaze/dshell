/**
 * Round-robin live polling of monitor captures via grim.
 */
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type {MonitorState} from './types';
import {POLL_INTERVAL_MS, captureMonitor} from './capture';

export class MonitorPoller {
    private timer = 0;
    private index = 0;

    /**
     * @param states monitors to poll
     * @param primaryPics pictures updated with every fresh capture
     * @param onTick called after each capture fires — use to refresh
     *        secondary pictures from the *previous* capture file
     */
    constructor(
        private states: MonitorState[],
        private primaryPics: Gtk.Picture[],
        private onTick?: (state: MonitorState, index: number) => void
    ) {}

    get running(): boolean {
        return this.timer !== 0;
    }

    start(): void {
        if (this.running) return;
        this.index = 0;
        this.timer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            POLL_INTERVAL_MS,
            this.tick
        );
    }

    stop(): void {
        if (this.running) {
            GLib.source_remove(this.timer);
            this.timer = 0;
        }
    }

    private tick = (): boolean => {
        const state = this.states[this.index];
        if (state) {
            captureMonitor(state, this.primaryPics);
            this.onTick?.(state, this.index);
        }
        this.index = (this.index + 1) % this.states.length;
        return GLib.SOURCE_CONTINUE;
    };
}
