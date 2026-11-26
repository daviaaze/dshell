import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {planWindowCaptureBatch, WINDOW_CAPTURE_LIMIT} from '../windowCaptureBatch';

function sources(...ids: (string | null)[]) {
    return ids.map((hyprStableId) => ({hyprStableId}));
}

const directory = '/private/picker-instance';

describe('planWindowCaptureBatch', () => {
    it('captures only eligible picker entries and preserves their indices', () => {
        expect(planWindowCaptureBatch(sources(null, 'a1', null, 'b2'), directory)).toEqual([
            {stableId: 'a1', path: `${directory}/window-0.png`, indices: [1]},
            {stableId: 'b2', path: `${directory}/window-1.png`, indices: [3]},
        ]);
    });

    it('captures a stable ID once and shares its result across duplicate entries', () => {
        expect(planWindowCaptureBatch(sources('a1', 'b2', 'a1'), directory)).toEqual([
            {stableId: 'a1', path: `${directory}/window-0.png`, indices: [0, 2]},
            {stableId: 'b2', path: `${directory}/window-1.png`, indices: [1]},
        ]);
    });

    it('keeps opaque IDs distinct without numeric conversion or case folding', () => {
        const batch = planWindowCaptureBatch(sources('a', 'A', '0a', '0'), directory);
        expect(batch.map((request) => request.stableId)).toEqual(['a', 'A', '0a', '0']);
    });

    it('bounds unique requests but still attaches later duplicates of included entries', () => {
        expect(WINDOW_CAPTURE_LIMIT).toBe(128);
        const windows = sources(
            ...Array.from({length: WINDOW_CAPTURE_LIMIT + 5}, (_, index) => `id-${index}`),
            'id-0'
        );
        const batch = planWindowCaptureBatch(windows, directory);
        expect(batch.length).toBe(WINDOW_CAPTURE_LIMIT);
        expect(batch[0].indices).toEqual([0, WINDOW_CAPTURE_LIMIT + 5]);
        expect(batch[WINDOW_CAPTURE_LIMIT - 1].stableId).toBe(`id-${WINDOW_CAPTURE_LIMIT - 1}`);
    });

    it('never uses an opaque ID as an output filename', () => {
        expect(planWindowCaptureBatch(sources('../other/window'), directory)[0].path).toBe(
            `${directory}/window-0.png`
        );
    });

    it('does not create a batch for an empty or unmatched portal list', () => {
        expect(planWindowCaptureBatch([], directory)).toEqual([]);
        expect(planWindowCaptureBatch(sources(null, null), directory)).toEqual([]);
    });
});

await run(import.meta.url);
