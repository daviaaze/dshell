import {describe, expect, it, run} from '../../../../packages/services/src/__tests__/test-runner';
import {monitorResolution} from '../monitorGeometry';

describe('monitorResolution', () => {
    it('swaps dimensions for quarter-turn monitor transforms', () => {
        expect(monitorResolution({width: 1920, height: 1080, transform: 1})).toEqual({
            width: 1080,
            height: 1920,
        });
        expect(monitorResolution({width: 1920, height: 1080, transform: 3})).toEqual({
            width: 1080,
            height: 1920,
        });
    });

    it('preserves dimensions for non-quarter-turn and missing transforms', () => {
        expect(monitorResolution({width: 1920, height: 1080, transform: 2})).toEqual({
            width: 1920,
            height: 1080,
        });
        expect(monitorResolution({width: 1920, height: 1080})).toEqual({
            width: 1920,
            height: 1080,
        });
    });
});

run();
