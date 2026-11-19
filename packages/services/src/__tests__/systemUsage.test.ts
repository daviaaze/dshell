import GLib from 'gi://GLib?version=2.0';
import SystemUsage, {
    DEFAULT_USAGE_OPTIONS,
    calculateCoreUsage,
    parseCpuCounters,
    parseCpuInfo,
    parseMemoryDetails,
    parseNetworkCounters,
    sortProcesses,
    type ProcessUsage,
} from '../monitoring/systemUsage';
import {describe, expect, it, run} from './test-runner';

describe('SystemUsage pure metrics', () => {
    it('excludes guest ticks already included in user/nice and handles baseline, hotplug and resets', () => {
        const before = parseCpuCounters('cpu0 100 20 30 40 10 5 5 2 8 1\ncpu1 1 1 1 1');
        const after = parseCpuCounters('cpu0 120 20 40 60 10 5 5 2 18 1\ncpu2 10 10 10 10');
        expect(before[0].total).toBe(212);
        expect(after[0].total).toBe(262);
        // +20 user +10 system +20 idle = 50 total; 30 busy / 50 = 0.6.
        // The guest delta is already part of user and must not be added again.
        expect(calculateCoreUsage(before, after)).toEqual([{id: 0, usage: 0.6}]);
        expect(calculateCoreUsage(after, parseCpuCounters('cpu0 1 1 1 1'))).toEqual([]);
    });

    it('selects aggregate or a named network interface without fabricating absent interfaces', () => {
        const sample = 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n lo: 900 0 0 0 0 0 0 0 800 0\n enp1s0: 1000 0 0 0 0 0 0 0 2000 0\n wlan0: 300 0 0 0 0 0 0 0 500 0';
        expect(parseNetworkCounters(sample).interfaces).toEqual(['lo', 'enp1s0', 'wlan0']);
        expect(parseNetworkCounters(sample).counters).toEqual({rx: 1300, tx: 2500});
        expect(parseNetworkCounters(sample, 'wlan0').counters).toEqual({rx: 300, tx: 500});
        expect(parseNetworkCounters(sample, 'missing').counters).toBe(null);
    });

    it('parses memory details and leaves unavailable CPU frequency unknown', () => {
        expect(parseMemoryDetails('MemFree: 10 kB\nMemAvailable: 30 kB\nCached: 20 kB\nSReclaimable: 4 kB')).toEqual({available: 30720, cached: 24576, free: 10240});
        expect(parseCpuInfo('model name : Example CPU\ncpu MHz : 2000\ncpu MHz : 2400')).toEqual({model: 'Example CPU', frequencyMHz: 2200});
        expect(parseCpuInfo('Hardware : ARM Example')).toEqual({model: 'ARM Example', frequencyMHz: null});
    });

    it('sorts full process candidates by selected metric before truncating', () => {
        const rows: ProcessUsage[] = [
            {pid: 1, name: 'busy', cpu: 0.9, rss: 10},
            {pid: 2, name: 'large', cpu: 0.1, rss: 100},
            {pid: 3, name: 'middle', cpu: 0.4, rss: 50},
        ];
        expect(sortProcesses(rows, 'memory', 2).map((row) => row.pid)).toEqual([2, 3]);
        expect(sortProcesses(rows, 'cpu', 2).map((row) => row.pid)).toEqual([1, 3]);
    });
});

describe('SystemUsage filesystem refresh', () => {
    it.async('keeps the previous disk reading available until its refresh completes', async () => {
        const usage = new SystemUsage();
        const options = {...DEFAULT_USAGE_OPTIONS, diskPath: GLib.get_tmp_dir()};
        usage.configure(options);
        usage.start();
        const initial = Promise.withResolvers<void>();
        const watchInitial = usage.diskAvailable.subscribe(() => {
            if (usage.diskAvailable()) initial.resolve();
        });
        const release = usage.subscribe();
        let watchRefresh: (() => void) | null = null;
        let watchAvailability: (() => void) | null = null;
        try {
            await initial.promise;
            const refreshed = Promise.withResolvers<void>();
            let unavailable = false;
            watchAvailability = usage.diskAvailable.subscribe(() => {
                if (!usage.diskAvailable()) unavailable = true;
            });
            watchRefresh = usage.diskBytes.subscribe(() => refreshed.resolve());
            // A changed option requests a new slow sample, without changing filesystem.
            usage.configure({...options, processCount: options.processCount + 1});
            expect(usage.diskAvailable()).toBe(true);
            await refreshed.promise;
            expect(unavailable).toBe(false);
            expect(usage.diskAvailable()).toBe(true);
        } finally {
            watchInitial();
            watchRefresh?.();
            watchAvailability?.();
            release();
        }
    });
});

await run(import.meta.url);
