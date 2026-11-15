/** Regression tests for screenshot selection geometry. */

import {describe, expect, it, run} from '../../../services/src/__tests__/test-runner';
import {desktopStageBounds} from '../../../services/src/capture/geometry';
import {
    buildGeometry,
    clampStagePoint,
    resizeEdgeAt,
    resizeRect,
    type SelectionState,
    stageToView,
    stageTransform,
    viewToStage,
} from '../screenshot-ui/selection';

describe('Screenshot selection geometry', () => {
    it('detects all edge and corner resize handles', () => {
        const rect = {x: 20, y: 30, width: 100, height: 80};
        for (const [point, edge] of [
            [{x: 20, y: 30}, 'nw'],
            [{x: 70, y: 30}, 'n'],
            [{x: 120, y: 30}, 'ne'],
            [{x: 20, y: 70}, 'w'],
            [{x: 120, y: 70}, 'e'],
            [{x: 20, y: 110}, 'sw'],
            [{x: 70, y: 110}, 's'],
            [{x: 120, y: 110}, 'se'],
        ] as const)
            expect(resizeEdgeAt(rect, point)).toBe(edge);
    });

    it('resizes the chosen edge without moving the opposite edge', () => {
        const original = {x: 40, y: 50, width: 160, height: 100};
        expect(resizeRect(original, 'w', {x: -20, y: 0})).toEqual({
            x: 20,
            y: 50,
            width: 180,
            height: 100,
        });
        expect(resizeRect(original, 'ne', {x: 30, y: -15})).toEqual({
            x: 40,
            y: 35,
            width: 190,
            height: 115,
        });
    });

    it('contains the complete multi-monitor stage and round-trips view coordinates', () => {
        const bounds = desktopStageBounds([
            {x: -1080, y: -240, width: 1920, height: 1080, transform: 3, scale: 1},
            {x: 0, y: 0, width: 3440, height: 1440, transform: 0, scale: 1},
        ]);
        expect(bounds).toEqual({x: -1080, y: -240, width: 4520, height: 1920});
        const transform = stageTransform(
            bounds.width,
            bounds.height,
            1200,
            800,
            bounds.x,
            bounds.y
        );
        const globalPoint = {x: 300, y: -100};
        const roundTrip = viewToStage(stageToView(globalPoint, transform), transform);
        expect(Math.round(roundTrip.x)).toBe(globalPoint.x);
        expect(Math.round(roundTrip.y)).toBe(globalPoint.y);
        expect(clampStagePoint({x: -50, y: 900}, transform)).toEqual({
            x: transform.offsetX,
            y: transform.offsetY + bounds.height * transform.scale,
        });
    });
    it('maps desktop axes independently when stage pixels and compositor units differ', () => {
        const transform = stageTransform(1000, 500, 400, 400, -100, -50, 2000, 1500);
        expect(transform.offsetY).toBe(50);
        expect(stageToView({x: 400, y: 200}, transform)).toEqual({x: 200, y: 200});
        const point = viewToStage({x: 200, y: 200}, transform);
        expect(Math.round(point.x)).toBe(400);
        expect(Math.round(point.y)).toBe(200);
    });

    it('maps selected stage coordinates back to the correct global crop', () => {
        const transform = stageTransform(4520, 1920, 1000, 700, -1080, -240);
        const selection: SelectionState = {
            dragStart: stageToView({x: 20, y: 40}, transform),
            dragEnd: stageToView({x: 420, y: 340}, transform),
            selActive: true,
            selectedWindow: null,
            windows: [],
            monOrigin: {x: -1080, y: -240},
            transform,
        };
        expect(buildGeometry('area', selection, transform)).toEqual({
            x: 20,
            y: 40,
            width: 400,
            height: 300,
        });
    });

    it('clamps selections to the image instead of including letterbox margins', () => {
        const transform = stageTransform(4000, 1000, 800, 600, -1000, -300);
        const selection: SelectionState = {
            dragStart: {x: 0, y: 100},
            dragEnd: {x: 800, y: 500},
            selActive: true,
            selectedWindow: null,
            windows: [],
            monOrigin: {x: -1000, y: -300},
        };
        expect(buildGeometry('area', selection, transform)).toEqual({
            x: -1000,
            y: -300,
            width: 4000,
            height: 1000,
        });
    });
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
