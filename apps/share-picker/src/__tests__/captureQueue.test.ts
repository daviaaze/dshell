import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {type CaptureJob, createCaptureQueue} from '../captureQueue';

function harness(limit: number) {
    const schedule = createCaptureQueue(limit);
    const started: number[] = [];
    const finish: (() => void)[] = [];
    const submit = (id: number): void => {
        const job: CaptureJob = (done) => {
            started.push(id);
            finish[id] = done;
        };
        schedule(job);
    };
    return {submit, started, finish};
}

describe('createCaptureQueue', () => {
    it('runs at most `limit` jobs at once and holds the rest', () => {
        const h = harness(2);
        for (let i = 0; i < 5; i++) h.submit(i);
        expect(h.started).toEqual([0, 1]);
    });

    it('starts the next waiting job, in order, as each one finishes', () => {
        const h = harness(2);
        for (let i = 0; i < 5; i++) h.submit(i);
        h.finish[0]();
        expect(h.started).toEqual([0, 1, 2]);
        h.finish[1]();
        h.finish[2]();
        expect(h.started).toEqual([0, 1, 2, 3, 4]);
    });

    it('frees a slot only once even if a job reports done twice', () => {
        const h = harness(1);
        h.submit(0);
        h.submit(1);
        h.submit(2);
        h.finish[0]();
        h.finish[0]();
        expect(h.started).toEqual([0, 1]);
    });

    it('runs new jobs immediately once the queue has drained', () => {
        const h = harness(1);
        h.submit(0);
        h.finish[0]();
        h.submit(1);
        expect(h.started).toEqual([0, 1]);
    });
});

run();
