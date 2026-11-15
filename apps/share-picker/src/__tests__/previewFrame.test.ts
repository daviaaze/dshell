import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {resolvePreviewFrame} from '../previewFrame';

describe('resolvePreviewFrame', () => {
    it('replaces the frame and clears stale status after a successful capture', () => {
        const previous = {frame: 1};
        const next = {frame: 2};

        const frame = resolvePreviewFrame(previous, next);
        expect(frame.texture).toBe(next);
        expect(frame.state).toBe('available');
    });

    it('preserves the last frame and marks it unavailable after a failed capture', () => {
        const previous = {frame: 1};

        const frame = resolvePreviewFrame(previous, null);
        expect(frame.texture).toBe(previous);
        expect(frame.state).toBe('unavailable');
    });

    it('reports unavailable when the first capture fails', () => {
        expect(resolvePreviewFrame(null, null)).toEqual({texture: null, state: 'unavailable'});
    });
});

run();
