/**
 * Behavioral tests for display profile persistence and transactions.
 */

import GLib from 'gi://GLib?version=2.0';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import LayoutService, {
    type DisplayAdapter,
    type DisplaySnapshot,
    type Layout,
    type MonitorSpec,
    type OutputInfo,
    parseHyprlandSnapshot,
    renderMonitorSpec,
} from '../layouts';

let storeCounter = 0;
const DP = (): OutputInfo => ({
    name: 'DP-1',
    description: 'External Panel',
    resolution: '1920x1080@60',
    position: '1920x0',
    scale: 1,
    transform: 0,
    vrr: null,
    disabled: false,
    enabled: true,
    dpms: true,
    width: 1920,
    height: 1080,
    x: 1920,
    y: 0,
    modes: [],
});
const EDP = (enabled = true): OutputInfo => ({
    name: 'eDP-1',
    description: 'Internal Panel',
    resolution: '1920x1200@60',
    position: '0x0',
    scale: 1,
    transform: 0,
    vrr: null,
    disabled: !enabled,
    enabled,
    dpms: true,
    width: 1920,
    height: 1200,
    x: 0,
    y: 0,
    modes: [],
});
const spec = (output: OutputInfo, disabled = !output.enabled): MonitorSpec => ({
    name: output.name,
    description: output.description,
    resolution: output.resolution,
    position: output.position,
    scale: output.scale,
    transform: output.transform,
    vrr: output.vrr,
    disabled,
});

class FakeAdapter implements DisplayAdapter {
    attached: OutputInfo[];
    writes: MonitorSpec[] = [];
    failNext = false;
    workspaceCalls: Array<{id: number; monitor: string}> = [];
    constructor(outputs: OutputInfo[]) {
        this.attached = outputs.map((output) => ({...output}));
    }
    async snapshot(): Promise<DisplaySnapshot> {
        const attached = this.attached.map((output) => ({...output}));
        return {attached, active: attached.filter((output) => output.enabled)};
    }
    async keyword(specification: MonitorSpec): Promise<void> {
        this.writes.push({...specification});
        if (this.failNext) {
            this.failNext = false;
            throw new Error('simulated monitor command failure');
        }
        const output = this.attached.find((item) => item.name === specification.name);
        if (!output) throw new Error(`not attached: ${specification.name}`);
        Object.assign(output, {
            enabled: !specification.disabled,
            disabled: specification.disabled,
            resolution: specification.resolution,
            position: specification.position,
            scale: specification.scale,
            transform: specification.transform,
            vrr: specification.vrr,
        });
    }
    async workspace(id: number, monitor: string): Promise<void> {
        this.workspaceCalls.push({id, monitor});
    }
}

function service(
    adapter: FakeAdapter,
    store: Layout = {monitors: [], workspaces: {}},
    autoApply = false
) {
    const storePath = GLib.build_filenamev([
        GLib.get_tmp_dir(),
        `shade-layouts-test-${++storeCounter}.json`,
    ]);
    GLib.unlink(storePath);
    const timers: Array<{delay: number; callback: () => void | Promise<void>}> = [];
    const instance = new LayoutService({
        adapter,
        storePath,
        schedule: (delay, callback) => {
            timers.push({delay, callback});
            return timers.length;
        },
        autoApply: () => autoApply,
        cancel: () => {},
    });
    if (store.monitors.length) instance.save('seed', store);
    return {instance, timers};
}

describe('renderMonitorSpec', () => {
    it('renders monitor rules and explicit disabled output', () => {
        expect(renderMonitorSpec(spec(DP()))).toBe('monitor DP-1,1920x1080@60,1920x0,1');
        expect(renderMonitorSpec({...spec(DP()), disabled: true})).toBe('monitor DP-1,disable');
    });
    it('parses real Hyprland monitor mode fields and retains inactive outputs', () => {
        const parsed = parseHyprlandSnapshot(
            [
                {
                    name: 'eDP-1',
                    description: 'AU Optronics 0x20A7',
                    width: 1920,
                    height: 1200,
                    refreshRate: 60.003,
                    x: 0,
                    y: 0,
                    scale: 1,
                    transform: 0,
                    currentFormat: 'XRGB8888',
                    availableModes: ['1920x1200@60.00Hz'],
                },
            ],
            [],
            [{id: 7, monitor: 'eDP-1'}]
        );
        expect(parsed.attached.length).toBe(1);
        expect(parsed.attached[0].enabled).toBe(false);
        expect(parsed.attached[0].resolution).toBe('1920x1200@60.00');
        expect(parsed.workspaces?.[7]).toBe('eDP-1');
        expect(parsed.attached[0].modes[0]?.refreshRate).toBe(60);
    });
});

describe('LayoutService transactions', () => {
    it.async(
        'does not auto-reenable a manually disabled internal panel when attached topology is unchanged',
        async () => {
            const adapter = new FakeAdapter([EDP(), DP()]);
            const {instance} = service(adapter);
            instance.init();
            await instance.setEnabled('eDP-1', false);
            const before = adapter.writes.length;
            await instance.reconcileNow();
            expect(adapter.writes.length).toBe(before);
        }
    );

    it.async(
        'recovers an attached internal panel when the last external display disconnects',
        async () => {
            const adapter = new FakeAdapter([EDP(false), DP()]);
            const {instance} = service(adapter);
            instance.init();
            await instance.reconcileNow();
            adapter.attached = [EDP(false)];
            await instance.reconcileNow();
            expect(adapter.attached[0].enabled).toBe(true);
            expect(adapter.writes[0].disabled).toBe(false);
        }
    );

    it.async(
        'enables intended outputs before disabling others and rejects disabling the last active output',
        async () => {
            const adapter = new FakeAdapter([EDP(), DP()]);
            const {instance} = service(adapter);
            instance.save('external', {
                monitors: [spec(EDP(), true), spec(DP())],
                workspaces: {1: 'DP-1'},
            });
            expect(await instance.apply('external')).toBe(true);
            expect(adapter.writes[0].name).toBe('DP-1');
            expect(adapter.writes[1].name).toBe('eDP-1');
            expect(adapter.workspaceCalls[0]?.id).toBe(1);
            expect(adapter.workspaceCalls[0]?.monitor).toBe('DP-1');
            expect(await instance.setEnabled('DP-1', false)).toBe(false);
        }
    );
    it.async('auto-applies only profiles matching the complete attached output set', async () => {
        const adapter = new FakeAdapter([EDP(), DP()]);
        const {instance} = service(adapter, {monitors: [], workspaces: {}}, true);
        instance.save('external-only', {monitors: [spec(DP())], workspaces: {}});
        instance.save('docked', {monitors: [spec(EDP(), true), spec(DP())], workspaces: {}});
        await instance.reconcileNow();
        expect(instance.current).toBe('docked');
        expect(adapter.writes[0].name).toBe('DP-1');
        expect(adapter.writes[1].name).toBe('eDP-1');
    });

    it.async('uses connector name to disambiguate duplicate display descriptions', async () => {
        const internal = {...EDP(), description: 'shared EDID'};
        const external = {...DP(), description: 'shared EDID'};
        const adapter = new FakeAdapter([internal, external]);
        const {instance} = service(adapter);
        instance.save('external', {
            monitors: [{...spec(external), description: 'shared EDID'}],
            workspaces: {},
        });
        expect(await instance.apply('external')).toBe(true);
        expect(adapter.writes[0].name).toBe('DP-1');
        expect(adapter.writes[1].name).toBe('eDP-1');
    });

    it.async('leaves current unchanged when a monitor command fails', async () => {
        const adapter = new FakeAdapter([EDP(), DP()]);
        const {instance} = service(adapter);
        instance.save('both', {monitors: [spec(EDP()), spec(DP())], workspaces: {}});
        adapter.failNext = true;
        expect(await instance.apply('both')).toBe(false);
        expect(instance.current).toBeNull();
    });

    it.async('reverts an unconfirmed preview after fifteen seconds', async () => {
        const adapter = new FakeAdapter([EDP(), DP()]);
        const {instance, timers} = service(adapter);
        const preview: Layout = {monitors: [spec(EDP()), spec(DP(), true)], workspaces: {}};
        expect(await instance.preview(preview)).toBe(true);
        expect(instance.pending).toBeDefined();
        const timer = timers.find((entry) => entry.delay === 15_000);
        if (!timer) throw new Error('Preview timeout was not scheduled');
        await timer.callback();
        expect(adapter.attached.find((output) => output.name === 'DP-1')?.enabled).toBe(true);
    });
});

await run(import.meta.url);
