import GTop from 'gi://GTop';
import {defineService} from '@shade/core/define';
import {barSettings} from '@shade/services/settings/bar.gschema';

/* eslint-disable camelcase -- wrapper names intentionally mirror the libgtop C API */
// GIR does not capture these raw C functions — typed wrappers around them.
const glibtop_get_cpu = (buffer: GTop.glibtop_cpu): void =>
    (GTop as unknown as {glibtop_get_cpu: (b: GTop.glibtop_cpu) => void}).glibtop_get_cpu(buffer);
const glibtop_get_mem = (buffer: GTop.glibtop_mem): void =>
    (GTop as unknown as {glibtop_get_mem: (b: GTop.glibtop_mem) => void}).glibtop_get_mem(buffer);
const glibtop_get_fsusage = (buffer: GTop.glibtop_fsusage, path: string): void =>
    (
        GTop as unknown as {glibtop_get_fsusage: (b: GTop.glibtop_fsusage, p: string) => void}
    ).glibtop_get_fsusage(buffer, path);
const glibtop_get_swap = (buffer: GTop.glibtop_swap): void =>
    (GTop as unknown as {glibtop_get_swap: (b: GTop.glibtop_swap) => void}).glibtop_get_swap(
        buffer
    );

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {type Accessor, createState} from 'gnim';

/** CPU/RAM poll interval (ms). These change frequently and feed live graphs. */
const POLL_INTERVAL_FAST = 1000;
/** Temperature/disk poll interval (ms). These change slowly. */
const POLL_INTERVAL_SLOW = 5000;
/** hwmon temp1_input is millidegrees. Divide by 1000 for °C, then 100 maps to 0..1. */
const TEMP_TO_LEVELBAR = 100000;
/** Samples kept for popup graphs (one per fast tick → 60 s of history). */
export const HISTORY_LENGTH = 60;

export interface NetRate {
    /** Received bytes per second, summed over non-loopback interfaces. */
    rx: number;
    /** Transmitted bytes per second, summed over non-loopback interfaces. */
    tx: number;
}

export interface StorageUsage {
    used: number;
    total: number;
}

function readProcFile(path: string): string | null {
    try {
        const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
        return ok ? new TextDecoder().decode(contents) : null;
    } catch {
        return null;
    }
}

/** Total rx/tx byte counters from /proc/net/dev, excluding loopback. */
function readNetCounters(): NetRate | null {
    const text = readProcFile('/proc/net/dev');
    if (!text) return null;
    let rx = 0;
    let tx = 0;
    for (const line of text.split('\n').slice(2)) {
        const [iface, data] = line.split(':');
        if (!data || iface.trim() === 'lo') continue;
        const fields = data.trim().split(/\s+/);
        rx += Number(fields[0]) || 0;
        tx += Number(fields[8]) || 0;
    }
    return {rx, tx};
}

function pushHistory(history: number[], value: number): number[] {
    const next = history.length >= HISTORY_LENGTH ? history.slice(1) : history.slice();
    next.push(value);
    return next;
}

/** Top-process poll interval (ms); runs only while a details view is open. */
const POLL_INTERVAL_PROCESSES = 2000;
const TOP_PROCESS_COUNT = 5;
/** Kernel page size, for converting /proc/<pid>/stat RSS pages to bytes. */
let pageSize: number | null = null;
function getPageSize(): number {
    if (pageSize === null) {
        try {
            pageSize = Number(Process.exec('getconf PAGESIZE')) || 4096;
        } catch {
            pageSize = 4096;
        }
    }
    return pageSize;
}

export interface ProcessUsage {
    pid: number;
    name: string;
    /** Share of total system CPU time since the previous sample (0..1). */
    cpu: number;
    /** Resident memory in bytes. */
    rss: number;
}

interface ProcTimes {
    name: string;
    ticks: number;
    rss: number;
}

/** Sum of all jiffies on the aggregate `cpu` line of /proc/stat. */
function readTotalTicks(): number {
    const line = readProcFile('/proc/stat')?.split('\n', 1)[0];
    if (!line) return 0;
    return line
        .split(/\s+/)
        .slice(1)
        .reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/** utime+stime and RSS for every process in /proc. */
function readProcessTimes(): Map<number, ProcTimes> {
    const out = new Map<number, ProcTimes>();
    let iter: Gio.FileEnumerator | null = null;
    try {
        iter = Gio.File.new_for_path('/proc').enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        for (let info = iter.next_file(null); info; info = iter.next_file(null)) {
            const pid = Number(info.get_name());
            if (!Number.isInteger(pid)) continue;
            const stat = readProcFile(`/proc/${pid}/stat`);
            if (!stat) continue;
            // comm may contain spaces/parens; fields resume after the last ')'.
            const open = stat.indexOf('(');
            const close = stat.lastIndexOf(')');
            const fields = stat.slice(close + 2).split(' ');
            // fields[0] is field 3 (state): utime=14, stime=15, rss=24.
            out.set(pid, {
                name: stat.slice(open + 1, close),
                ticks: Number(fields[11]) + Number(fields[12]),
                rss: Number(fields[21]) * getPageSize(),
            });
        }
    } catch (e) {
        logger.warn('systemUsage', 'process scan failed:', e);
    } finally {
        iter?.close(null);
    }
    return out;
}

/** Auto-discover the coretemp Package id 0 sensor path. */
function findCoretempPath(): string | null {
    const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon');
    let iter: Gio.FileEnumerator | null = null;
    try {
        iter = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info: Gio.FileInfo | null;
        while ((info = iter.next_file(null)) !== null) {
            const hwmonName = info.get_name();
            const nameFile = iter.get_child(info).get_child('name');
            try {
                const [ok, contents] = nameFile.load_contents(null);
                if (ok && new TextDecoder().decode(contents).trim() === 'coretemp') {
                    return `/sys/class/hwmon/${hwmonName}/temp1_input`;
                }
            } catch {
                // hwmon entry without a name file — skip
            }
        }
    } catch (e) {
        logger.error(
            'systemUsage',
            'hwmon enumeration failed:',
            e instanceof Error ? e.message : String(e)
        );
    } finally {
        iter?.close(null);
    }
    return null;
}

/**
 * CPU / RAM / disk / temperature sampler.
 *
 * GTop has no change notification, so sampling is inherently periodic — the
 * poll lives here in the service and widgets bind to the state accessors.
 */
export default class SystemUsage {
    private static instance: SystemUsage;

    static get_default(): SystemUsage {
        if (!SystemUsage.instance) SystemUsage.instance = new SystemUsage();
        return SystemUsage.instance;
    }

    #lastCpuTop = new GTop.glibtop_cpu();
    #tempPath: string | null = null;
    #tempFailed = false;
    #started = false;
    #bindCount = 0;
    #fastTimer: number | null = null;
    #slowTimer: number | null = null;
    #slowTick = 0;
    #lastNet: NetRate | null = null;
    #lastNetTime = 0;
    #procTimer: number | null = null;
    #procSubscribers = 0;
    #lastProcTimes: Map<number, ProcTimes> | null = null;
    #lastTotalTicks = 0;

    #cpu: Accessor<number>;
    #setCpu: (v: number) => void;
    #memory: Accessor<number>;
    #setMemory: (v: number) => void;
    #disk: Accessor<number>;
    #setDisk: (v: number) => void;
    #temp: Accessor<number>;
    #setTemp: (v: number) => void;
    #tempAvailable: Accessor<boolean>;
    #setTempAvailable: (v: boolean) => void;
    #cpuHistory: Accessor<number[]>;
    #setCpuHistory: (v: number[]) => void;
    #memoryHistory: Accessor<number[]>;
    #setMemoryHistory: (v: number[]) => void;
    #netRxHistory: Accessor<number[]>;
    #setNetRxHistory: (v: number[]) => void;
    #netTxHistory: Accessor<number[]>;
    #setNetTxHistory: (v: number[]) => void;
    #net: Accessor<NetRate>;
    #setNet: (v: NetRate) => void;
    #memoryBytes: Accessor<StorageUsage>;
    #setMemoryBytes: (v: StorageUsage) => void;
    #swapBytes: Accessor<StorageUsage>;
    #setSwapBytes: (v: StorageUsage) => void;
    #diskBytes: Accessor<StorageUsage>;
    #setDiskBytes: (v: StorageUsage) => void;
    #loadAverage: Accessor<[number, number, number]>;
    #setLoadAverage: (v: [number, number, number]) => void;
    #uptime: Accessor<number>;
    #setUptime: (v: number) => void;
    #topProcesses: Accessor<ProcessUsage[]>;
    #setTopProcesses: (v: ProcessUsage[]) => void;

    constructor() {
        [this.#cpu, this.#setCpu] = createState(0);
        [this.#memory, this.#setMemory] = createState(0);
        [this.#disk, this.#setDisk] = createState(0);
        [this.#temp, this.#setTemp] = createState(0);
        [this.#tempAvailable, this.#setTempAvailable] = createState(false);
        [this.#cpuHistory, this.#setCpuHistory] = createState<number[]>([]);
        [this.#memoryHistory, this.#setMemoryHistory] = createState<number[]>([]);
        [this.#netRxHistory, this.#setNetRxHistory] = createState<number[]>([]);
        [this.#netTxHistory, this.#setNetTxHistory] = createState<number[]>([]);
        [this.#net, this.#setNet] = createState<NetRate>({rx: 0, tx: 0});
        [this.#memoryBytes, this.#setMemoryBytes] = createState<StorageUsage>({used: 0, total: 0});
        [this.#swapBytes, this.#setSwapBytes] = createState<StorageUsage>({used: 0, total: 0});
        [this.#diskBytes, this.#setDiskBytes] = createState<StorageUsage>({used: 0, total: 0});
        [this.#loadAverage, this.#setLoadAverage] = createState<[number, number, number]>([
            0, 0, 0,
        ]);
        [this.#uptime, this.#setUptime] = createState(0);
        [this.#topProcesses, this.#setTopProcesses] = createState<ProcessUsage[]>([]);
    }

    get cpu(): Accessor<number> {
        return this.#cpu;
    }
    get memory(): Accessor<number> {
        return this.#memory;
    }
    get disk(): Accessor<number> {
        return this.#disk;
    }
    get temp(): Accessor<number> {
        return this.#temp;
    }
    get tempAvailable(): Accessor<boolean> {
        return this.#tempAvailable;
    }
    /** Last {@link HISTORY_LENGTH} CPU samples (0..1), oldest first. */
    get cpuHistory(): Accessor<number[]> {
        return this.#cpuHistory;
    }
    /** Last {@link HISTORY_LENGTH} RAM samples (0..1), oldest first. */
    get memoryHistory(): Accessor<number[]> {
        return this.#memoryHistory;
    }
    /** Last {@link HISTORY_LENGTH} download rates (bytes/s), oldest first. */
    get netRxHistory(): Accessor<number[]> {
        return this.#netRxHistory;
    }
    /** Last {@link HISTORY_LENGTH} upload rates (bytes/s), oldest first. */
    get netTxHistory(): Accessor<number[]> {
        return this.#netTxHistory;
    }
    get net(): Accessor<NetRate> {
        return this.#net;
    }
    get memoryBytes(): Accessor<StorageUsage> {
        return this.#memoryBytes;
    }
    get swapBytes(): Accessor<StorageUsage> {
        return this.#swapBytes;
    }
    get diskBytes(): Accessor<StorageUsage> {
        return this.#diskBytes;
    }
    /** 1, 5 and 15 minute load averages. */
    get loadAverage(): Accessor<[number, number, number]> {
        return this.#loadAverage;
    }
    /** Seconds since boot. */
    get uptime(): Accessor<number> {
        return this.#uptime;
    }
    /** Busiest processes by CPU; populated only while {@link subscribeProcesses} is held. */
    get topProcesses(): Accessor<ProcessUsage[]> {
        return this.#topProcesses;
    }

    /**
     * Start scanning /proc for top processes. Scanning every process is far
     * costlier than the bar's sampling, so it runs only while a details view
     * (the bar popup) is visible.
     */
    subscribeProcesses(): () => void {
        this.#procSubscribers++;
        if (this.#procSubscribers === 1) {
            this.#sampleProcesses();
            this.#procTimer = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                POLL_INTERVAL_PROCESSES,
                () => {
                    this.#sampleProcesses();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
        return () => {
            this.#procSubscribers--;
            if (this.#procSubscribers > 0 || this.#procTimer === null) return;
            GLib.source_remove(this.#procTimer);
            this.#procTimer = null;
            this.#lastProcTimes = null;
        };
    }

    #sampleProcesses(): void {
        const totalTicks = readTotalTicks();
        const times = readProcessTimes();
        const previous = this.#lastProcTimes;
        const elapsed = totalTicks - this.#lastTotalTicks;
        this.#lastProcTimes = times;
        this.#lastTotalTicks = totalTicks;
        // First scan has no baseline; publish once a delta exists.
        if (!previous || elapsed <= 0) return;

        const usage: ProcessUsage[] = [];
        for (const [pid, t] of times) {
            const before = previous.get(pid);
            const delta = before ? t.ticks - before.ticks : 0;
            usage.push({pid, name: t.name, cpu: Math.max(0, delta / elapsed), rss: t.rss});
        }
        usage.sort((a, b) => b.cpu - a.cpu || b.rss - a.rss);
        this.#setTopProcesses(usage.slice(0, TOP_PROCESS_COUNT));
    }

    /**
     * Launch a system monitor command asynchronously.
     * Widgets call this instead of Process.execAsync directly.
     */
    launchMonitor(cmd: string): void {
        Process.execAsync(cmd).catch((e) =>
            logger.error('systemUsage', 'failed to launch monitor:', e)
        );
    }

    /**
     * Service lifecycle init — delegates to start().
     * This allows SystemUsage to be managed by ServiceRegistry.
     */
    init(userTempPath?: string): void {
        this.start(userTempPath);
    }

    /**
     * Subscribe a widget to sampling. Polling starts on the first subscribe
     * and stops when the last widget unsubscribes — no wakeups at idle.
     */
    subscribe(): () => void {
        this.#bindCount++;
        if (this.#bindCount === 1) this.#resume();
        return () => {
            this.#bindCount--;
            if (this.#bindCount === 0) this.#pause();
        };
    }

    /**
     * Start sampling. `userTempPath` (from settings) takes priority over
     * auto-discovery. Idempotent — safe to call from every widget instance.
     */
    start(userTempPath?: string): void {
        if (this.#started) return;
        this.#started = true;

        this.#tempPath =
            (userTempPath && Gio.File.new_for_path(userTempPath).query_exists(null)
                ? userTempPath
                : null) ?? findCoretempPath();

        if (!this.#tempPath) {
            if (userTempPath) {
                logger.error(
                    'systemUsage',
                    `configured temp-path "${userTempPath}" does not exist or is not a file, and no sensor was auto-detected`
                );
            } else {
                logger.error(
                    'systemUsage',
                    'no temperature sensor found — set bar.temp-path or ensure coretemp is loaded'
                );
            }
        }

        // Auto-start polling on first widget mount.
        this.#resume();
    }

    #resume(): void {
        if (this.#fastTimer !== null) return;
        this.#sample();
        this.#fastTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_FAST, () => {
            this.#sampleFast();
            return GLib.SOURCE_CONTINUE;
        });
        this.#slowTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SLOW, () => {
            this.#sampleSlow();
            return GLib.SOURCE_CONTINUE;
        });
    }

    #pause(): void {
        if (this.#fastTimer !== null) {
            GLib.source_remove(this.#fastTimer);
            this.#fastTimer = null;
        }
        if (this.#slowTimer !== null) {
            GLib.source_remove(this.#slowTimer);
            this.#slowTimer = null;
        }
    }

    /** Fast path: CPU, RAM, network. Changes frequently, polled every second. */
    #sampleFast(): void {
        const cpuTop = new GTop.glibtop_cpu();
        glibtop_get_cpu(cpuTop);
        const total = cpuTop.total - this.#lastCpuTop.total;
        const user = cpuTop.user - this.#lastCpuTop.user;
        const sys = cpuTop.sys - this.#lastCpuTop.sys;
        const nice = cpuTop.nice - this.#lastCpuTop.nice;
        this.#lastCpuTop = cpuTop;
        const cpu = (user + sys + nice) / (total || 1);
        this.#setCpu(cpu);
        this.#setCpuHistory(pushHistory(this.#cpuHistory(), cpu));

        const memTop = new GTop.glibtop_mem();
        glibtop_get_mem(memTop);
        const memory = memTop.user / memTop.total;
        this.#setMemory(memory);
        this.#setMemoryHistory(pushHistory(this.#memoryHistory(), memory));
        this.#setMemoryBytes({used: memTop.user, total: memTop.total});

        const now = GLib.get_monotonic_time();
        const counters = readNetCounters();
        if (counters && this.#lastNet) {
            const seconds = (now - this.#lastNetTime) / 1_000_000 || 1;
            const rate = {
                rx: Math.max(0, (counters.rx - this.#lastNet.rx) / seconds),
                tx: Math.max(0, (counters.tx - this.#lastNet.tx) / seconds),
            };
            this.#setNet(rate);
            this.#setNetRxHistory(pushHistory(this.#netRxHistory(), rate.rx));
            this.#setNetTxHistory(pushHistory(this.#netTxHistory(), rate.tx));
        }
        this.#lastNet = counters;
        this.#lastNetTime = now;
    }

    /** Slow path: disk, swap, load, uptime, temperature. Polled every 5s. */
    #sampleSlow(): void {
        const diskTop = new GTop.glibtop_fsusage();
        glibtop_get_fsusage(diskTop, '/');
        this.#setDisk((diskTop.blocks - diskTop.bavail) / diskTop.blocks);
        this.#setDiskBytes({
            used: (diskTop.blocks - diskTop.bavail) * diskTop.block_size,
            total: diskTop.blocks * diskTop.block_size,
        });

        const swapTop = new GTop.glibtop_swap();
        glibtop_get_swap(swapTop);
        this.#setSwapBytes({used: swapTop.used, total: swapTop.total});

        const load = readProcFile('/proc/loadavg')?.split(' ');
        if (load) this.#setLoadAverage([Number(load[0]), Number(load[1]), Number(load[2])]);
        const uptime = readProcFile('/proc/uptime');
        if (uptime) this.#setUptime(Number(uptime.split(' ')[0]));

        if (this.#tempPath && !this.#tempFailed) {
            try {
                const file = Gio.File.new_for_path(this.#tempPath);
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const value = parseInt(new TextDecoder().decode(contents));
                    this.#setTemp(value / TEMP_TO_LEVELBAR);
                    this.#setTempAvailable(true);
                }
            } catch (e) {
                logger.error('systemUsage', 'failed to read temperature:', e);
                this.#setTempAvailable(false);
                this.#tempFailed = true;
            }
        }
    }

    /** Sample everything immediately (e.g. on widget mount for instant data). */
    #sample(): void {
        this.#sampleFast();
        this.#sampleSlow();
    }
}

defineService({
    name: 'SystemUsage',
    service: SystemUsage.get_default(),
    initArgs: () => [barSettings().tempPath()],
});
