/**
 * Round-robin live polling of monitor captures via grim.
 */
import GLib from 'gi://GLib?version=2.0';
import {captureMonitor, POLL_INTERVAL_MS} from './capture';
import type {MonitorState, PreviewHandle} from './types';

export class MonitorPoller {
    private timer = 0;
    private index = 0;

    constructor(
        private states: MonitorState[],
        private targets: readonly (readonly PreviewHandle[])[]
    ) {}

    get running(): boolean {
        return this.timer !== 0;
    }

    start(): void {
        if (this.running || this.states.length === 0) return;
        this.index = 0;
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, this.tick);
    }

    stop(): void {
        if (this.running) {
            GLib.source_remove(this.timer);
            this.timer = 0;
        }
    }

    private tick = (): boolean => {
        const index = this.index;
        const state = this.states[index];
        const targets = this.targets[index];
        if (state && targets) captureMonitor(state, targets);
        this.index = (index + 1) % this.states.length;
        return GLib.SOURCE_CONTINUE;
    };
}
