import logger from '#/lib/core/logger';
import {Process} from '#/lib/core/process';

/**
 * wayfreeze process lifecycle — freezes the screen so area selection happens
 * on a static frame. Extracted from the Screenshot service.
 */
export class Freeze {
    #process: Process | null = null;
    #onActiveChange: (active: boolean) => void;

    constructor(onActiveChange: (active: boolean) => void) {
        this.#onActiveChange = onActiveChange;
    }

    get running(): boolean {
        return this.#process !== null;
    }

    start(): void {
        if (this.#process) return;
        try {
            const proc = Process.subprocessv(['wayfreeze', '--hide-cursor']);
            this.#process = proc;
            this.#onActiveChange(true);
            proc.connect('exit', () => {
                this.#process = null;
                this.#onActiveChange(false);
            });
        } catch {
            logger.warn(
                'screenshot',
                'wayfreeze not available, skipping freeze'
            );
        }
    }

    stop(): void {
        if (this.#process) {
            try {
                this.#process.signal(2);
                this.#process.signal(15);
            } catch {
                /* already dead */
            }
            this.#process = null;
        }
        this.#onActiveChange(false);
    }
}
