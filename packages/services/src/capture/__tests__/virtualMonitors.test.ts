import {Process} from '@shade/core/process';
import {CompositorPort} from '../../compositor/port';
import {describe, expect, it, run} from '../../__tests__/test-runner';
import type {VirtualMonitor} from '../types';
import {createVirtualMonitor, removeVirtualMonitors} from '../virtualMonitors';

function fakeCompositor() {
    const original = {
        create: CompositorPort.prototype.createHeadlessOutput,
        remove: CompositorPort.prototype.removeOutput,
        snapshot: CompositorPort.prototype.displaySnapshot,
        apply: CompositorPort.prototype.applyMonitor,
        exec: Process.execAsyncv,
    };
    const names = new Set(['HEADLESS-1', 'SHADE-VMON-unrelated']);
    const created: string[] = [];
    const removed: string[] = [];
    const configured: string[] = [];
    CompositorPort.prototype.createHeadlessOutput = async (name) => {
        created.push(name);
        names.add(name);
    };
    CompositorPort.prototype.removeOutput = async (name) => {
        removed.push(name);
        names.delete(name);
    };
    CompositorPort.prototype.displaySnapshot = async () => ({
        all: [...names].map((name) => ({name})),
        active: [],
        workspaces: [],
    });
    CompositorPort.prototype.applyMonitor = async (monitor) => {
        configured.push(monitor.name);
    };
    Process.execAsyncv = async () => '';
    return {
        names,
        created,
        removed,
        configured,
        restore() {
            CompositorPort.prototype.createHeadlessOutput = original.create;
            CompositorPort.prototype.removeOutput = original.remove;
            CompositorPort.prototype.displaySnapshot = original.snapshot;
            CompositorPort.prototype.applyMonitor = original.apply;
            Process.execAsyncv = original.exec;
        },
    };
}

describe('Virtual monitor ownership', () => {
    it.async(
        'serializes duplicate creates and never adopts pre-existing headless outputs',
        async () => {
            const fake = fakeCompositor();
            const monitors: VirtualMonitor[] = [];
            try {
                const [first, second] = await Promise.all([
                    createVirtualMonitor(monitors),
                    createVirtualMonitor(monitors),
                ]);
                expect(fake.created.length).toBe(1);
                expect(monitors.length).toBe(1);
                expect(first).toBe(second);
                expect(first?.name).toBe(fake.created[0]);
                expect(fake.configured).toEqual(fake.created);
                await removeVirtualMonitors(monitors);
                expect(fake.removed).toEqual(fake.created);
                expect(fake.names.has('HEADLESS-1')).toBe(true);
                expect(fake.names.has('SHADE-VMON-unrelated')).toBe(true);
            } finally {
                await removeVirtualMonitors(monitors);
                fake.restore();
            }
        }
    );

    it.async('queues removal behind an in-flight creation', async () => {
        const fake = fakeCompositor();
        const monitors: VirtualMonitor[] = [];
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        CompositorPort.prototype.createHeadlessOutput = async (name) => {
            fake.created.push(name);
            entered.resolve();
            await gate.promise;
            fake.names.add(name);
        };
        try {
            const creation = createVirtualMonitor(monitors);
            await entered.promise;
            const removal = removeVirtualMonitors(monitors);
            expect(fake.removed.length).toBe(0);
            gate.resolve();
            await creation;
            await removal;
            expect(fake.removed).toEqual(fake.created);
            expect(monitors.length).toBe(0);
        } finally {
            gate.resolve();
            await removeVirtualMonitors(monitors);
            fake.restore();
        }
    });

    it.async('rolls back a created output when configuration fails', async () => {
        const fake = fakeCompositor();
        const monitors: VirtualMonitor[] = [];
        CompositorPort.prototype.applyMonitor = async () => {
            throw new Error('configuration failed');
        };
        try {
            expect(await createVirtualMonitor(monitors)).toBeNull();
            expect(fake.created.length).toBe(1);
            expect(fake.removed).toEqual(fake.created);
            expect(monitors.length).toBe(0);
        } finally {
            await removeVirtualMonitors(monitors);
            fake.restore();
        }
    });

    it.async('retains failed cleanup for retry and refuses to remove unowned names', async () => {
        const fake = fakeCompositor();
        const monitors: VirtualMonitor[] = [];
        let failRemoval = true;
        CompositorPort.prototype.removeOutput = async (name) => {
            if (failRemoval) throw new Error('remove failed');
            fake.removed.push(name);
            fake.names.delete(name);
        };
        try {
            const created = await createVirtualMonitor(monitors);
            if (!created) throw new Error('Expected an owned virtual monitor');
            const unrelated = {name: 'HEADLESS-1', resolution: '1920x1080', fps: 60};
            monitors.push(unrelated);
            await removeVirtualMonitors(monitors);
            expect(monitors).toEqual([created, unrelated]);
            failRemoval = false;
            await removeVirtualMonitors(monitors);
            expect(fake.removed).toEqual([created.name]);
            expect(monitors).toEqual([unrelated]);
        } finally {
            failRemoval = false;
            await removeVirtualMonitors(monitors);
            fake.restore();
        }
    });
});

await run(import.meta.url);
