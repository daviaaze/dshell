/**
 * Bounded fan-out for capture jobs (pure, no GI): at most `limit` run at once,
 * the rest start in FIFO order as running ones finish.
 *
 * `start(done)` must call `done()` exactly once when the job ends, success or
 * failure — a job that never calls it would hold a slot forever.
 */
export type CaptureJob = (done: () => void) => void;

export function createCaptureQueue(limit: number): (job: CaptureJob) => void {
    let active = 0;
    const waiting: CaptureJob[] = [];

    const launch = (job: CaptureJob): void => {
        active++;
        let finished = false;
        job(() => {
            if (finished) return;
            finished = true;
            active--;
            const next = waiting.shift();
            if (next) launch(next);
        });
    };

    return (job) => {
        if (active < limit) launch(job);
        else waiting.push(job);
    };
}
