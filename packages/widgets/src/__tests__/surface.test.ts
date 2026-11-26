import {getPopoverMaxHeight, SURFACE_EDGE_GAP} from '../common/surface';
import {describe, expect, it, run} from './test-runner';

type Anchor = Parameters<typeof getPopoverMaxHeight>[0];

/** Anchor whose monitor reports `height` application pixels at the given scale factor. */
const anchorOnMonitor = (height: number, scale: number): Anchor =>
    ({
        get_native: () => ({get_surface: () => ({})}),
        get_display: () => ({
            get_monitor_at_surface: () => ({
                get_geometry: () => ({height}),
                get_scale_factor: () => scale,
            }),
        }),
    }) as unknown as Anchor;

describe('getPopoverMaxHeight', () => {
    it('uses the monitor geometry as application pixels, whatever the scale factor', () => {
        expect(getPopoverMaxHeight(anchorOnMonitor(1080, 1))).toBe(1080 - SURFACE_EDGE_GAP * 2);
        expect(getPopoverMaxHeight(anchorOnMonitor(1080, 2))).toBe(1080 - SURFACE_EDGE_GAP * 2);
    });

    it('falls back to 600 when the anchor has no monitor', () => {
        const detached = {
            get_native: () => null,
            get_display: () => ({}),
        } as unknown as Anchor;
        expect(getPopoverMaxHeight(detached)).toBe(600);
    });
});

run(import.meta.url);
