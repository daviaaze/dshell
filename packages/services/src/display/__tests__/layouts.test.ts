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
} from '../layouts';
import {
    buildDisplayMode,
    detectDisplayMode,
    getAvailableDisplayModes,
    logicalMonitorSize,
    setLayoutOutputEnabled,
} from '../modes';

type Deferred = {promise: Promise<void>; resolve: () => void};

let storeCounter = 0;

function output(
    name: string,
    id: number,
    enabled = true,
    properties: Partial<OutputInfo> & {mirror?: string | null} = {}
): OutputInfo {
    const internal = /^eDP-/.test(name);
    const position = properties.position ?? (internal ? '0x0' : '1920x0');
    const resolution = properties.resolution ?? (internal ? '1920x1200@60' : '1920x1080@60');
    const [x, y] = position.split('x').map(Number);
    return {
        name,
        description: properties.description ?? `${name} display`,
        resolution,
        position,
        scale: properties.scale ?? 1,
        transform: properties.transform ?? 0,
        vrr: properties.vrr ?? null,
        disabled: !enabled,
        enabled,
        dpms: properties.dpms ?? true,
        width: 1920,
        height: internal ? 1200 : 1080,
        x: x ?? 0,
        y: y ?? 0,
        modes: properties.modes ?? [],
        id,
        mirror: properties.mirror ?? null,
    } as OutputInfo;
}

const DP = (enabled = true, properties: Partial<OutputInfo> = {}) =>
    output('DP-1', 2, enabled, properties);
const HDMI = (enabled = true, properties: Partial<OutputInfo> = {}) =>
    output('HDMI-A-1', 1, enabled, properties);
const DP2 = (enabled = true, properties: Partial<OutputInfo> = {}) =>
    output('DP-2', 3, enabled, properties);
const EDP = (enabled = true, properties: Partial<OutputInfo> = {}) =>
    output('eDP-1', 0, enabled, properties);

const spec = (
    outputInfo: OutputInfo,
    disabled = !outputInfo.enabled,
    mirror: string | null = (outputInfo as OutputInfo & {mirror?: string | null}).mirror ?? null
): MonitorSpec =>
    ({
        name: outputInfo.name,
        description: outputInfo.description,
        resolution: outputInfo.resolution,
        position: outputInfo.position,
        scale: outputInfo.scale,
        transform: outputInfo.transform,
        vrr: outputInfo.vrr,
        disabled,
        mirror,
    }) as MonitorSpec;

function independent(snapshot: DisplaySnapshot): OutputInfo[] {
    return snapshot.attached.filter(
        (monitor) => monitor.enabled && !(monitor as OutputInfo & {mirror: string | null}).mirror
    );
}

function deferred(): Deferred {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

class FakeAdapter implements DisplayAdapter {
    attached: OutputInfo[];
    writes: MonitorSpec[] = [];
    failNext = false;
    failAfterMutation = false;
    failName: string | null = null;
    ignoreMirrorWrites = false;
    workspaceCalls: Array<{id: number; monitor: string}> = [];
    writeBarrier: {name: string; started: Deferred; release: Deferred} | null = null;
    constructor(outputs: OutputInfo[]) {
        this.attached = outputs.map((outputInfo) => ({...outputInfo}));
    }
    async snapshot(): Promise<DisplaySnapshot> {
        const attached = this.attached.map((outputInfo) => ({...outputInfo}));
        return {attached, active: independent({attached, active: []})};
    }
    async keyword(specification: MonitorSpec): Promise<void> {
        this.writes.push({...specification});
        const barrier = this.writeBarrier;
        if (barrier?.name === specification.name) {
            this.writeBarrier = null;
            barrier.started.resolve();
            await barrier.release.promise;
        }
        const shouldFail = this.failNext || this.failName === specification.name;
        if (shouldFail && !this.failAfterMutation) {
            this.failNext = false;
            this.failName = null;
            throw new Error('simulated monitor command failure');
        }
        const outputInfo = this.attached.find((item) => item.name === specification.name);
        if (!outputInfo) throw new Error(`not attached: ${specification.name}`);
        const numericPosition = /^(-?\d+)x(-?\d+)$/.exec(specification.position);
        let x = outputInfo.x;
        let y = outputInfo.y;
        if (numericPosition) {
            x = Number(numericPosition[1]);
            y = Number(numericPosition[2]);
        } else if (specification.position === 'auto-right') {
            x = this.attached.reduce((right, monitor) => {
                if (monitor.name === outputInfo.name || !monitor.enabled || monitor.mirror)
                    return right;
                return Math.max(right, monitor.x + monitor.width / monitor.scale);
            }, 0);
            y = 0;
        }
        let mirror = outputInfo.mirror;
        if (!specification.disabled) {
            mirror = specification.mirror ?? null;
            if (this.ignoreMirrorWrites && specification.mirror) mirror = null;
        }
        Object.assign(outputInfo, {
            enabled: !specification.disabled,
            disabled: specification.disabled,
            resolution: specification.resolution,
            position: `${x}x${y}`,
            scale: specification.scale,
            transform: specification.transform,
            vrr: specification.vrr,
            x,
            y,
            mirror,
        });
        if (shouldFail && this.failAfterMutation) {
            this.failNext = false;
            this.failName = null;
            this.failAfterMutation = false;
            throw new Error('simulated monitor command failure');
        }
    }
    async workspace(id: number, monitor: string): Promise<void> {
        this.workspaceCalls.push({id, monitor});
    }
    blockNextWrite(name: string) {
        const barrier = {name, started: deferred(), release: deferred()};
        this.writeBarrier = barrier;
        return barrier;
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
    const timers: Array<{
        id: number;
        delay: number;
        callback: () => void | Promise<void>;
        cancelled: boolean;
    }> = [];
    const instance = new LayoutService({
        adapter,
        storePath,
        schedule: (delay, callback) => {
            const timer = {id: timers.length + 1, delay, callback, cancelled: false};
            timers.push(timer);
            return timer.id;
        },
        autoApply: () => autoApply,
        cancel: (id) => {
            const timer = timers.find((entry) => entry.id === id);
            if (timer) timer.cancelled = true;
        },
    });
    if (store.monitors.length) instance.save('seed', store);
    return {instance, timers, storePath};
}

describe('monitor snapshots', () => {
    it('parses monitor modes while retaining attached but inactive outputs', () => {
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

    it('distinguishes physical enablement from logical activity for mirrors', () => {
        const monitor = (name: string, id: number, extra: Record<string, unknown> = {}) => ({
            name,
            id,
            description: name,
            width: 1920,
            height: 1080,
            refreshRate: 60,
            x: 0,
            y: 0,
            scale: 1,
            transform: 0,
            disabled: false,
            dpmsStatus: name !== 'HDMI-A-1',
            ...extra,
        });
        const parsed = parseHyprlandSnapshot(
            [
                monitor('eDP-1', 0),
                monitor('HDMI-A-1', 1, {mirrorOf: '0'}),
                monitor('DP-1', 2, {x: 1920}),
            ],
            [monitor('eDP-1', 0), monitor('DP-1', 2, {x: 1920})]
        );
        const mirrored = parsed.attached[1] as OutputInfo & {id: number; mirror: string | null};
        expect(parsed.attached.length).toBe(3);
        expect(parsed.active.length).toBe(2);
        expect(parsed.attached.every((monitorInfo) => monitorInfo.enabled)).toBe(true);
        expect(mirrored.id).toBe(1);
        expect(mirrored.mirror).toBe('eDP-1');
        expect(mirrored.dpms).toBe(false);
    });

    it('rejects a mirror source id that is not attached', () => {
        expect(() =>
            parseHyprlandSnapshot([{name: 'HDMI-A-1', id: 1, disabled: false, mirrorOf: '99'}], [])
        ).toThrowMatching(
            (error) =>
                error instanceof Error && error.message === 'Mirror source is not attached: 99'
        );
    });
});

describe('display mode helpers', () => {
    it('lists available modes in stable order for each topology', () => {
        expect(getAvailableDisplayModes([DP(), EDP(), HDMI()])).toEqual([
            'internal-only',
            'external-only',
            'extend',
            'duplicate',
        ]);
        expect(getAvailableDisplayModes([EDP()])).toEqual(['internal-only']);
        const twoPanels = [output('eDP-2', 4), EDP(), DP()];
        expect(getAvailableDisplayModes(twoPanels)).toEqual([
            'internal-only',
            'external-only',
            'extend',
            'duplicate',
        ]);
        expect(
            buildDisplayMode('external-only', twoPanels)?.monitors.find(
                (monitorSpec) => monitorSpec.name === 'eDP-2'
            )?.disabled
        ).toBe(false);
        expect(getAvailableDisplayModes([DP(), HDMI()])).toEqual(['extend', 'duplicate']);
        expect(getAvailableDisplayModes([])).toEqual([]);
    });

    it('builds internal-only, external-only, extend, and duplicate layouts for three outputs', () => {
        const attached = [EDP(), HDMI(), DP()];
        const internal = buildDisplayMode('internal-only', attached);
        const external = buildDisplayMode('external-only', attached);
        const extend = buildDisplayMode('extend', attached);
        const duplicate = buildDisplayMode('duplicate', attached);
        if (!internal || !external || !extend || !duplicate)
            throw new Error('Expected all four modes to be available');
        const entry = (layout: Layout, name: string) =>
            layout.monitors.find((monitorSpec) => monitorSpec.name === name);
        expect(entry(internal, 'eDP-1')?.disabled).toBe(false);
        expect(entry(internal, 'DP-1')?.disabled).toBe(true);
        expect(entry(external, 'eDP-1')?.disabled).toBe(true);
        expect(entry(external, 'HDMI-A-1')?.position).toBe('0x0');
        expect(entry(external, 'DP-1')?.position).toBe('auto-right');
        expect(entry(extend, 'eDP-1')?.position).toBe('0x0');
        expect(entry(extend, 'HDMI-A-1')?.position).toBe('auto-right');
        expect(entry(extend, 'DP-1')?.position).toBe('auto-right');
        expect(entry(extend, 'HDMI-A-1')?.mirror).toBe(null);
        expect(entry(duplicate, 'eDP-1')?.mirror).toBe(null);
        expect(entry(duplicate, 'HDMI-A-1')?.mirror).toBe('eDP-1');
        expect(entry(duplicate, 'DP-1')?.mirror).toBe('eDP-1');
        expect(entry(duplicate, 'DP-1')?.position).toBe('0x0');
        expect(duplicate.workspaces).toEqual({});
    });

    it('preserves per-output mode settings and duplicates from the lexical source without a panel', () => {
        const attached = [
            HDMI(true, {resolution: '2560x1440@59.95', scale: 1.25, transform: 1, vrr: 1}),
            DP(true, {resolution: '1280x1024@60', scale: 1.5}),
            DP2(),
        ];
        const duplicate = buildDisplayMode('duplicate', attached);
        if (!duplicate) throw new Error('Duplicate should be available');
        const hdmi = duplicate.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1');
        const dp = duplicate.monitors.find((monitorSpec) => monitorSpec.name === 'DP-1');
        expect(hdmi?.mirror).toBe('DP-1');
        expect(hdmi?.resolution).toBe('2560x1440@59.95');
        expect(hdmi?.scale).toBe(1.25);
        expect(hdmi?.transform).toBe(1);
        expect(hdmi?.vrr).toBe(1);
        expect(dp?.mirror).toBe(null);
        expect(dp?.position).toBe('0x0');
        expect(buildDisplayMode('external-only', attached)).toBeNull();
        expect(detectDisplayMode(attached)).toBe('extend');
    });

    it('detects panel, external, extended, duplicated, and mixed configurations', () => {
        expect(detectDisplayMode([EDP()])).toBe('internal-only');
        expect(detectDisplayMode([EDP(false), DP()])).toBe('external-only');
        expect(detectDisplayMode([EDP(), HDMI(), DP()])).toBe('extend');
        expect(
            detectDisplayMode([EDP(), HDMI(true, {mirror: 'eDP-1'}), DP(true, {mirror: 'eDP-1'})])
        ).toBe('duplicate');
        expect(
            detectDisplayMode([
                EDP(),
                HDMI(true, {mirror: 'eDP-1'}),
                DP(true, {position: '3000x50'}),
            ])
        ).toBe('custom');
        expect(detectDisplayMode([DP(), HDMI()])).toBe('extend');
    });

    it('computes logical size from draft resolution, transform, and scale', () => {
        expect(
            logicalMonitorSize(
                {...spec(DP()), resolution: '2560x1440@60', scale: 2, transform: 1},
                DP()
            )
        ).toEqual({width: 720, height: 1280});
        expect(
            logicalMonitorSize(
                {...spec(DP()), resolution: 'preferred', scale: 1, transform: 0},
                DP()
            )
        ).toEqual({width: 1920, height: 1080});
    });

    it('transforms output toggles without dropping unrelated layout geometry', () => {
        const source = EDP();
        const mirror = HDMI(true, {position: '0x0', mirror: 'eDP-1'});
        const independent = DP(true, {position: '3500x200'});
        const mixed: Layout = {
            monitors: [spec(source), spec(mirror), spec(independent)],
            workspaces: {},
        };
        const withoutMirror = setLayoutOutputEnabled(mixed, 'HDMI-A-1', false);
        const withoutSource = setLayoutOutputEnabled(mixed, 'eDP-1', false);
        if (!withoutMirror || !withoutSource) throw new Error('Expected valid toggle results');
        expect(
            withoutMirror.monitors.find((monitorSpec) => monitorSpec.name === 'eDP-1')?.disabled
        ).toBe(false);
        expect(
            withoutMirror.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1')?.disabled
        ).toBe(true);
        expect(
            withoutSource.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1')?.mirror
        ).toBe(null);
        expect(
            withoutSource.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1')?.position
        ).toBe('0x0');
        expect(
            withoutSource.monitors.find((monitorSpec) => monitorSpec.name === 'DP-1')?.position
        ).toBe('3500x200');
        expect(
            setLayoutOutputEnabled({monitors: [spec(EDP())], workspaces: {}}, 'eDP-1', false)
        ).toBeNull();
    });

    it('clears an invalid mirror when re-enabling an output', () => {
        const invalid = {
            monitors: [spec(EDP(false)), spec(HDMI(false, {mirror: 'eDP-1'}))],
            workspaces: {},
        };
        const enabled = setLayoutOutputEnabled(invalid, 'HDMI-A-1', true);
        expect(
            enabled?.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1')?.mirror
        ).toBe(null);
        expect(
            enabled?.monitors.find((monitorSpec) => monitorSpec.name === 'HDMI-A-1')?.position
        ).toBe('auto-right');
    });
});

type ServiceModeApi = {
    previewMode(mode: string): Promise<boolean>;
    toggleInternal(): Promise<boolean>;
    confirm(): Promise<boolean>;
    displayMode: string;
    availableDisplayModes: string[];
};

describe('LayoutService display modes and mirror transactions', () => {
    it.async(
        'previews External only before disabling the panel and applies every attached external',
        async () => {
            const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
            const {instance} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.previewMode('external-only')).toBe(true);
            expect(adapter.writes[0]?.name).toBe('HDMI-A-1');
            expect(adapter.writes[1]?.name).toBe('DP-1');
            expect(adapter.writes[2]?.name).toBe('eDP-1');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled
            ).toBe(false);
            expect(adapter.attached.filter((monitorInfo) => monitorInfo.enabled).length).toBe(2);
            expect(await api.confirm()).toBe(true);
        }
    );

    it.async(
        'previews Extend and Duplicate across all outputs and exposes reactive mode state',
        async () => {
            const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
            const {instance} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(api.availableDisplayModes).toEqual([
                'internal-only',
                'external-only',
                'extend',
                'duplicate',
            ]);
            expect(api.displayMode).toBe('extend');
            expect(await api.previewMode('duplicate')).toBe(true);
            expect(adapter.attached.every((monitorInfo) => monitorInfo.enabled)).toBe(true);
            expect(
                (
                    adapter.attached.find(
                        (monitorInfo) => monitorInfo.name === 'HDMI-A-1'
                    ) as OutputInfo & {
                        mirror: string | null;
                    }
                ).mirror
            ).toBe('eDP-1');
            expect(await api.confirm()).toBe(true);
            expect(api.displayMode).toBe('duplicate');
            expect(await api.previewMode('extend')).toBe(true);
            expect(adapter.attached.every((monitorInfo) => !monitorInfo.mirror)).toBe(true);
        }
    );

    it.async('reports unavailable mode actions without writes or a pending preview', async () => {
        const adapter = new FakeAdapter([EDP()]);
        const {instance} = service(adapter);
        const api = instance as unknown as ServiceModeApi;
        expect(await api.previewMode('external-only')).toBe(false);
        expect(instance.error).toBe('No external displays are attached');
        expect(await api.previewMode('duplicate')).toBe(false);
        expect(instance.error).toBe('Duplicate needs at least two attached displays');
        expect(await api.previewMode('custom')).toBe(false);
        expect(instance.error).toBe('Unknown display mode: custom');
        expect(adapter.writes.length).toBe(0);
        expect(instance.pending).toBeNull();
        const desktop = service(new FakeAdapter([DP(), HDMI()]))
            .instance as unknown as ServiceModeApi;
        expect(await desktop.previewMode('internal-only')).toBe(false);
        expect((desktop as unknown as LayoutService).error).toBe('No internal display is attached');
    });
    it.async(
        'does not write or arm a timer when the selected mode already matches live outputs',
        async () => {
            const adapter = new FakeAdapter([
                EDP(),
                HDMI(true, {position: '1920x0'}),
                DP(true, {position: '3840x0'}),
            ]);
            const {instance} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(api.displayMode).toBe('extend');
            expect(await api.previewMode('extend')).toBe(true);
            expect(adapter.writes.length).toBe(0);
            expect(instance.pending).toBeNull();
        }
    );

    it.async(
        'saves, previews, and restores a mirrored pair beside an independent display',
        async () => {
            const adapter = new FakeAdapter([
                EDP(),
                HDMI(true, {position: '0x0', mirror: 'eDP-1'}),
                DP(true, {position: '3200x180'}),
            ]);
            const {instance} = service(adapter);
            const mixed: Layout = {
                monitors: [
                    spec(EDP()),
                    spec(HDMI(true, {position: '0x0', mirror: 'eDP-1'})),
                    spec(DP(true, {position: '3200x180'})),
                ],
                workspaces: {},
            };
            expect(instance.save('Mixed', mixed)).toBe(true);
            expect(await instance.apply('Mixed')).toBe(true);
            expect(adapter.writes[0]?.name).toBe('eDP-1');
            expect(adapter.writes[1]?.name).toBe('DP-1');
            expect(adapter.writes[2]?.name).toBe('HDMI-A-1');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
            ).toBe('eDP-1');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.position
            ).toBe('3200x180');
            expect((await adapter.snapshot()).active.length).toBe(2);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.previewMode('extend')).toBe(true);
            expect(await instance.revert()).toBe(undefined);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
            ).toBe('eDP-1');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.position
            ).toBe('3200x180');
            expect(instance.current).toBe('Mixed');
        }
    );

    it.async('rolls back when the compositor ignores a requested mirror relationship', async () => {
        const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
        adapter.ignoreMirrorWrites = true;
        const {instance} = service(adapter);
        instance.save('mirrored', {
            monitors: [spec(EDP()), spec(HDMI(), false, 'eDP-1'), spec(DP())],
            workspaces: {},
        });
        expect(await instance.apply('mirrored')).toBe(false);
        expect(instance.error).toBe('Invalid mirror configuration');
        expect(adapter.attached.every((monitorInfo) => !monitorInfo.mirror)).toBe(true);
    });

    it.async('resolves saved mirror sources through renamed connector descriptions', async () => {
        const adapter = new FakeAdapter([
            output('eDP-9', 0, true, {description: 'Laptop panel'}),
            output('HDMI-9', 1, true, {description: 'Dock mirror'}),
            output('DP-9', 2, true, {description: 'Desk screen', position: '3500x200'}),
        ]);
        const {instance} = service(adapter);
        const source = EDP(true, {description: 'Laptop panel'});
        const mirror = HDMI(true, {description: 'Dock mirror', mirror: 'eDP-1'});
        const extended = DP(true, {description: 'Desk screen', position: '3500x200'});
        instance.save('renamed', {
            monitors: [spec(source), spec(mirror, false, 'eDP-1'), spec(extended)],
            workspaces: {},
        });
        expect(await instance.apply('renamed')).toBe(true);
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-9')?.mirror).toBe(
            'eDP-9'
        );
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-9')?.position).toBe(
            '3500x200'
        );
    });

    it.async(
        'rejects invalid self, chain, missing-source, and disabled-source graphs before writing',
        async () => {
            const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
            const {instance} = service(adapter);
            const invalid: Layout[] = [
                {
                    monitors: [spec(EDP()), spec(HDMI(true, {mirror: 'HDMI-A-1'})), spec(DP())],
                    workspaces: {},
                },
                {
                    monitors: [
                        spec(EDP()),
                        spec(HDMI(true, {mirror: 'eDP-1'})),
                        spec(DP(true, {mirror: 'HDMI-A-1'})),
                    ],
                    workspaces: {},
                },
                {
                    monitors: [spec(EDP()), spec(HDMI(true, {mirror: 'missing'})), spec(DP())],
                    workspaces: {},
                },
                {
                    monitors: [spec(EDP(), true), spec(HDMI(true, {mirror: 'eDP-1'})), spec(DP())],
                    workspaces: {},
                },
                {
                    monitors: [spec(EDP()), spec(EDP()), spec(DP())],
                    workspaces: {},
                },
            ];
            for (const [index, layout] of invalid.entries()) {
                instance.save(`invalid-${index}`, layout);
                const writesBefore = adapter.writes.length;
                expect(await instance.apply(`invalid-${index}`)).toBe(false);
                expect(adapter.writes.length).toBe(writesBefore);
            }
        }
    );

    it.async('toggles a mirror destination without disabling its independent source', async () => {
        const adapter = new FakeAdapter([EDP(), HDMI(true, {mirror: 'eDP-1'}), DP()]);
        const {instance} = service(adapter);
        expect(await instance.setEnabled('HDMI-A-1', false)).toBe(true);
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled).toBe(
            true
        );
        expect(
            adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.enabled
        ).toBe(false);
        expect(instance.pending).toBeDefined();
    });

    it.async('promotes only the lexical-first mirror when disabling its source', async () => {
        const adapter = new FakeAdapter([
            EDP(),
            HDMI(true, {position: '0x0', mirror: 'eDP-1'}),
            DP(true, {position: '0x0', mirror: 'eDP-1'}),
            DP2(true, {position: '3800x300'}),
        ]);
        const {instance} = service(adapter);
        expect(await instance.setEnabled('eDP-1', false)).toBe(true);
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.mirror).toBe(
            null
        );
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.position).toBe(
            '0x0'
        );
        expect(
            adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
        ).toBe('DP-1');
        expect(adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-2')?.position).toBe(
            '3800x300'
        );
        expect((await adapter.snapshot()).active.length).toBe(2);
    });

    it.async(
        'refuses to disable the final independent desktop even when mirror destinations remain',
        async () => {
            const adapter = new FakeAdapter([
                EDP(),
                HDMI(true, {mirror: 'eDP-1'}),
                DP(true, {mirror: 'eDP-1'}),
            ]);
            const {instance} = service(adapter);
            expect(await instance.setEnabled('eDP-1', false)).toBe(true);
            const outputs = await adapter.snapshot();
            expect(outputs.active.length).toBe(1);
            expect(outputs.active[0]?.name).toBe('DP-1');
            const singlePanel = service(new FakeAdapter([EDP()])).instance;
            expect(await singlePanel.setEnabled('eDP-1', false)).toBe(false);
            expect(singlePanel.error).toBe('Cannot disable the last enabled display');
        }
    );

    it.async(
        'restores cached output settings without stealing mirrors or overlapping active desktops',
        async () => {
            const adapter = new FakeAdapter([EDP(), DP(true, {position: '0x0', scale: 1.25})]);
            const {instance} = service(adapter);
            expect(await instance.setEnabled('DP-1', false)).toBe(true);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.confirm()).toBe(true);
            expect(await instance.setEnabled('DP-1', true)).toBe(true);
            const restored = adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1');
            expect(restored?.scale).toBe(1.25);
            expect(restored?.position).toBe('auto-right');
        }
    );

    it.async(
        'toggles only the panel and opens a safe independent layout when re-enabled',
        async () => {
            const adapter = new FakeAdapter([
                EDP(),
                HDMI(true, {position: '0x0', mirror: 'eDP-1'}),
                DP(true, {position: '3500x200'}),
            ]);
            const {instance} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.toggleInternal()).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled
            ).toBe(false);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.enabled
            ).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.enabled
            ).toBe(true);
            expect(await api.confirm()).toBe(true);
            expect(await api.toggleInternal()).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled
            ).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
            ).toBe(null);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.position
            ).toBe('3500x200');
        }
    );

    it.async(
        'retains a rollback baseline across previews and ignores an obsolete queued timeout',
        async () => {
            const original = [
                EDP(),
                HDMI(true, {mirror: 'eDP-1'}),
                DP(true, {position: '3100x170'}),
            ];
            const adapter = new FakeAdapter(original);
            const {instance, timers} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.previewMode('external-only')).toBe(true);
            const oldTimer = timers.find((timer) => timer.delay === 15_000);
            if (!oldTimer) throw new Error('First preview timeout was not scheduled');
            expect(await api.previewMode('duplicate')).toBe(true);
            const latestTimer = timers.filter((timer) => timer.delay === 15_000).at(-1);
            if (!latestTimer) throw new Error('Replacement preview timeout was not scheduled');
            const barrier = adapter.blockNextWrite('eDP-1');
            const replacement = api.previewMode('extend');
            await barrier.started.promise;
            const obsoleteTimeout = oldTimer.callback();
            barrier.release.resolve();
            expect(await replacement).toBe(true);
            await obsoleteTimeout;
            const replacementTimer = timers.filter((timer) => timer.delay === 15_000).at(-1);
            if (!replacementTimer) throw new Error('Final preview timeout was not scheduled');
            await latestTimer.callback();
            expect(api.displayMode).toBe('extend');
            expect(adapter.attached.every((monitorInfo) => monitorInfo.enabled)).toBe(true);
            expect(adapter.attached.every((monitorInfo) => !monitorInfo.mirror)).toBe(true);
            await replacementTimer.callback();
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
            ).toBe('eDP-1');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.position
            ).toBe('3100x170');
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled
            ).toBe(true);
        }
    );

    it.async(
        'queues confirmation behind a preview write and preserves pending rollback after failure',
        async () => {
            const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
            const {instance} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            const barrier = adapter.blockNextWrite('HDMI-A-1');
            const preview = api.previewMode('external-only');
            await barrier.started.promise;
            const confirm = api.confirm();
            barrier.release.resolve();
            expect(await preview).toBe(true);
            expect(await confirm).toBe(true);
            expect(instance.pending).toBeNull();

            expect(await api.previewMode('extend')).toBe(true);
            const deadline = instance.pending;
            adapter.failName = 'DP-1';
            adapter.failAfterMutation = true;
            expect(await api.previewMode('duplicate')).toBe(false);
            expect(instance.pending).toBe(deadline);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.enabled
            ).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'HDMI-A-1')?.mirror
            ).toBe(null);
        }
    );

    it.async(
        'recovers the internal panel on topology loss without replaying a preview rollback',
        async () => {
            const adapter = new FakeAdapter([EDP(), HDMI(), DP()]);
            const {instance, timers} = service(adapter);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.previewMode('external-only')).toBe(true);
            const timeout = timers.filter((timer) => timer.delay === 15_000).at(-1);
            if (!timeout) throw new Error('Preview timeout was not scheduled');
            adapter.attached = [EDP(false)];
            await instance.reconcileNow();
            expect(instance.pending).toBeNull();
            expect(adapter.attached[0]?.enabled).toBe(true);
            expect(adapter.attached[0]?.mirror).toBe(null);
            const writeCount = adapter.writes.length;
            await timeout.callback();
            expect(adapter.writes.length).toBe(writeCount);
        }
    );

    it.async(
        'retains a surviving logical desktop after partial hotplug and unmirrors a recovered panel',
        async () => {
            const adapter = new FakeAdapter([EDP(true, {mirror: 'DP-1'}), HDMI(), DP()]);
            const {instance} = service(adapter, {monitors: [], workspaces: {}}, false);
            adapter.attached = [EDP(true, {mirror: 'DP-1'}), DP()];
            await instance.reconcileNow();
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'DP-1')?.enabled
            ).toBe(true);
            expect(
                adapter.attached.find((monitorInfo) => monitorInfo.name === 'eDP-1')?.mirror
            ).toBe('DP-1');

            adapter.attached = [EDP(true, {mirror: 'missing-source'})];
            await instance.reconcileNow();
            expect(adapter.attached[0]?.enabled).toBe(true);
            expect(adapter.attached[0]?.mirror).toBe(null);
            expect((await adapter.snapshot()).active[0]?.name).toBe('eDP-1');
        }
    );

    it.async(
        'normalizes version-one profiles without mirror fields when previewing and confirming',
        async () => {
            const adapter = new FakeAdapter([EDP(), DP()]);
            const {instance, storePath} = service(adapter);
            GLib.file_set_contents(
                storePath,
                JSON.stringify({
                    version: 1,
                    current: 'Docked',
                    layouts: {
                        Docked: {
                            monitors: [
                                {
                                    name: 'eDP-1',
                                    description: 'eDP-1 display',
                                    resolution: '1920x1200@60',
                                    position: '0x0',
                                    scale: 1,
                                    transform: 0,
                                    vrr: null,
                                    disabled: false,
                                },
                                {
                                    name: 'DP-1',
                                    description: 'DP-1 display',
                                    resolution: '1920x1080@60',
                                    position: '1920x0',
                                    scale: 1,
                                    transform: 0,
                                    vrr: null,
                                    disabled: false,
                                },
                            ],
                            workspaces: {},
                        },
                    },
                })
            );
            expect(await instance.preview(instance.get('Docked') as Layout)).toBe(true);
            const api = instance as unknown as ServiceModeApi;
            expect(await api.confirm()).toBe(true);
            expect(instance.current).toBe('Docked');
            const savedText = GLib.file_get_contents(storePath);
            const saved = JSON.parse(new TextDecoder().decode(savedText[1]));
            expect(saved.version).toBe(1);
            expect(
                saved.layouts.Docked.monitors.every(
                    (monitorSpec: MonitorSpec) => monitorSpec.mirror === null
                )
            ).toBe(true);
        }
    );
});

await run(import.meta.url);
