/**
 * Tests for LayoutService — spec rendering and store persistence.
 *
 * Hyprland IPC is unavailable in tests (no live session), so these cover
 * the pure parts: hyprctl line rendering and the layout store round-trip.
 */

import GLib from 'gi://GLib?version=2.0';
import LayoutService, {renderMonitorSpec, type Layout} from '../layouts';
import {describe, expect, it, run} from '../../__tests__/test-runner';

let storeCounter = 0;

/** Point the store at a fresh unique temp file and drop any singleton. */
function freshService(): LayoutService {
    const tmp = GLib.build_filenamev([GLib.get_tmp_dir(), `shade-layouts-test-${++storeCounter}.json`]);
    GLib.unlink(tmp); // discard leftovers from previous runs (counter resets each process)
    GLib.setenv('SHADE_LAYOUTS_FILE', tmp, true);
    LayoutService.testReset();
    return LayoutService.get_default();
}

const SAMPLE: Layout = {
    monitors: [
        {
            name: 'DP-1',
            resolution: '3440x1440@144',
            position: '0x0',
            scale: 1,
            transform: 0,
            vrr: 1,
            disabled: false,
        },
        {
            name: 'HDMI-A-1',
            resolution: '1080x1920@60',
            position: '-1080x0',
            scale: 1.25,
            transform: 1,
            vrr: null,
            disabled: false,
        },
    ],
    workspaces: {1: 'DP-1', 2: 'DP-1', 3: 'HDMI-A-1'},
};

describe('renderMonitorSpec', () => {
    it('renders a full spec with transform and vrr', () => {
        expect(renderMonitorSpec(SAMPLE.monitors[0])).toBe('monitor DP-1,3440x1440@144,0x0,1,vrr,1');
    });

    it('renders transform and fractional scale', () => {
        expect(renderMonitorSpec(SAMPLE.monitors[1])).toBe(
            'monitor HDMI-A-1,1080x1920@60,-1080x0,1.25,transform,1'
        );
    });

    it('omits transform 0 and vrr 0', () => {
        expect(
            renderMonitorSpec({
                name: 'DP-1',
                resolution: 'preferred',
                position: 'auto',
                scale: 1,
                transform: 0,
                vrr: 0,
                disabled: false,
            })
        ).toBe('monitor DP-1,preferred,auto,1');
    });

    it('renders disabled monitors as disable lines', () => {
        expect(renderMonitorSpec({...SAMPLE.monitors[0], disabled: true})).toBe('monitor DP-1,disable');
    });
});

describe('LayoutService store', () => {
    it('saves and reloads layouts from disk', () => {
        const svc = freshService();
        expect(svc.save('Home', SAMPLE)).toBe(true);
        expect(svc.get('Home')).toEqual(SAMPLE);

        // A fresh instance (same env path) reads the persisted store.
        LayoutService.testReset();
        const reloaded = LayoutService.get_default();
        expect(reloaded.names).toEqual(['Home']);
        expect(reloaded.get('Home')).toEqual(SAMPLE);
    });

    it('sorts layout names', () => {
        const svc = freshService();
        svc.save('zeta', SAMPLE);
        svc.save('alpha', SAMPLE);
        expect(svc.names).toEqual(['alpha', 'zeta']);
    });

    it('refuses empty names', () => {
        const svc = freshService();
        expect(svc.save('   ')).toBe(false);
        expect(svc.names).toEqual([]);
    });

    it('refuses empty captures (no Hyprland in tests)', () => {
        const svc = freshService();
        expect(svc.save('Empty')).toBe(false);
        expect(svc.names).toEqual([]);
    });

    it('remove deletes a layout and clears current', async () => {
        const svc = freshService();
        svc.save('Home', SAMPLE);
        expect(await svc.apply('Home')).toBe(true);
        expect(svc.current).toBe('Home');
        expect(svc.remove('Home')).toBe(true);
        expect(svc.names).toEqual([]);
        expect(svc.current).toBeNull();
    });

    it('apply of unknown layout returns false', async () => {
        const svc = freshService();
        expect(await svc.apply('missing')).toBe(false);
    });

    it('remove of unknown layout returns false', () => {
        const svc = freshService();
        expect(svc.remove('missing')).toBe(false);
    });
});

await run(import.meta.url);