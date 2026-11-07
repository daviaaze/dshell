/** Regression tests for screenshot selection geometry. */

import {buildGeometry, type SelectionState} from '../screenshot-ui/selection';
import {describe, expect, it, run} from '../../../services/src/__tests__/test-runner';

describe('Screenshot selection geometry', () => {
    it('rounds global area edges to compositor pixels', () => {
        const selection: SelectionState = {
            dragStart: {x: 179.9609375, y: 159.984375},
            dragEnd: {x: 499.9609375, y: 359.984375},
            selActive: true,
            selectedWindow: null,
            windows: [],
            monOrigin: {x: -1920, y: -1080},
        };

        const geometry = buildGeometry('area', selection);
        expect(geometry).toEqual({x: -1740, y: -920, width: 320, height: 200});
    });
});

await run(import.meta.url);
