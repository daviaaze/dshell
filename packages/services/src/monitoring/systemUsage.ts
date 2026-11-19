import GTop from 'gi://GTop';
import {defineService} from '@shade/core/define';
import {barSettings} from '@shade/services/settings/bar.gschema';

/* eslint-disable camelcase -- wrapper names intentionally mirror the libgtop C API */
// GIR does not capture these raw C functions — typed wrappers around them.
const glibtop_get_cpu = (buffer: GTop.glibtop_cpu): void =>
    (GTop as unknown as {glibtop_get_cpu: (b: GTop.glibtop_cpu) => void}).glibtop_get_cpu(buffer);
const glibtop_get_mem = (buffer: GTop.glibtop_mem): void =>
    (GTop as unknown as {glibtop_get_mem: (b: GTop.glibtop_mem) => void}).glibtop_get_mem(buffer);
const glibtop_get_swap = (buffer: GTop.glibtop_swap): void =>
    (GTop as unknown as {glibtop_get_swap: (b: GTop.glibtop_swap) => void}).glibtop_get_swap(
        buffer
    );

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {type Accessor, createState} from 'gnim';

/** Temperature/disk poll interval (ms). Temperature and filesystem update slowly. */
const POLL_INTERVAL_SLOW = 5000;
const TEMP_TO_LEVELBAR = 100000;
/** Samples retained; actual history duration follows the configured interval. */
export const HISTORY_LENGTH = 60;

export interface NetRate {
    rx: number;
    tx: number;
}

export interface StorageUsage {
    used: number;
    total: number;
}

export interface CpuCoreUsage {
    id: number;
    usage: number;
}

export interface MemoryDetails {
    available: number;
    cached: number;
    free: number;
}

export interface UsageOptions {
    intervalMs: number;
    networkInterface: string;
    diskPath: string;
    processSort: 'cpu' | 'memory';
    processCount: number;
    tempPath: string;
}

export const DEFAULT_USAGE_OPTIONS: UsageOptions = {
    intervalMs: 1000,
    networkInterface: '',
    diskPath: '/',
    processSort: 'cpu',
    processCount: 5,
    tempPath: '',
};

export interface CpuCounters {
    id: number;
    total: number;
    idle: number;
}

export function parseCpuCounters(text: string): CpuCounters[] {
    const result: CpuCounters[] = [];
    for (const line of text.split('\n')) {
        const match = /^cpu(\d+)\s+(.+)$/.exec(line);
        if (!match) continue;
        const values = match[2].trim().split(/\s+/).map(Number);
        if (values.length < 4 || values.some((value) => !Number.isFinite(value))) continue;
        // Linux user,nice,system,idle,iowait,irq,softirq,steal,guest,guest_nice.
        // guest fields are already included in user/nice and must not be added again.
        result.push({
            id: Number(match[1]),
            total: values.slice(0, 8).reduce((sum, value) => sum + value, 0),
            idle: values[3] + (values[4] ?? 0),
        });
    }
    return result;
}

export function calculateCoreUsage(
    previous: CpuCounters[],
    current: CpuCounters[]
): CpuCoreUsage[] {
    const before = new Map(previous.map((core) => [core.id, core]));
    return current.flatMap((core) => {
        const old = before.get(core.id);
        if (!old) return [];
        const total = core.total - old.total;
        const idle = core.idle - old.idle;
        if (total <= 0 || idle < 0 || idle > total) return [];
        return [{id: core.id, usage: Math.max(0, Math.min(1, (total - idle) / total))}];
    });
}

export interface NetworkCounters {
    rx: number;
    tx: number;
}

export function parseNetworkCounters(
    text: string,
    selectedInterface = ''
): {interfaces: string[]; counters: NetworkCounters | null} {
    const interfaces: string[] = [];
    let rx = 0;
    let tx = 0;
    let found = false;
    for (const line of text.split('\n').slice(2)) {
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        const name = line.slice(0, separator).trim();
        if (!name) continue;
        interfaces.push(name);
        if (name === 'lo' || (selectedInterface && selectedInterface !== name)) continue;
        const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
        if (fields.length < 9 || !Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
        rx += fields[0];
        tx += fields[8];
        found = true;
    }
    return {interfaces, counters: found ? {rx, tx} : null};
}

export function parseMemoryDetails(text: string): MemoryDetails {
    const values = new Map<string, number>();
    for (const line of text.split('\n')) {
        const match = /^(\w+):\s+(\d+)\s+kB/.exec(line);
        if (match) values.set(match[1], Number(match[2]) * 1024);
    }
    return {
        available: values.get('MemAvailable') ?? 0,
        cached: (values.get('Cached') ?? 0) + (values.get('SReclaimable') ?? 0),
        free: values.get('MemFree') ?? 0,
    };
}

export function parseCpuInfo(text: string): {model: string; frequencyMHz: number | null} {
    let model = '';
    const frequencies: number[] = [];
    for (const line of text.split('\n')) {
        const modelMatch = /^(?:model name|Hardware|Processor)\s*:\s*(.+)$/.exec(line);
        if (!model && modelMatch) model = modelMatch[1].trim();
        const frequencyMatch = /^cpu MHz\s*:\s*([\d.]+)$/.exec(line);
        if (frequencyMatch && Number.isFinite(Number(frequencyMatch[1])))
            frequencies.push(Number(frequencyMatch[1]));
    }
    return {
        model,
        frequencyMHz: frequencies.length
            ? frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length
            : null,
    };
}

function readProcFile(path: string): string | null {
    try {
        const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
        return ok ? new TextDecoder().decode(contents) : null;
    } catch {
        return null;
    }
}

function pushHistory(history: number[], value: number): number[] {
    const next = history.length >= HISTORY_LENGTH ? history.slice(1) : history.slice();
    next.push(value);
    return next;
}

const POLL_INTERVAL_PROCESSES = 2000;
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
    cpu: number;
    rss: number;
}

interface ProcTimes {
    name: string;
    ticks: number;
    rss: number;
}

export function sortProcesses(
    processes: ProcessUsage[],
    sort: 'cpu' | 'memory',
    count: number
): ProcessUsage[] {
    return [...processes]
        .sort((a, b) => (sort === 'memory' ? b.rss - a.rss || b.cpu - a.cpu : b.cpu - a.cpu || b.rss - a.rss))
        .slice(0, count);
}

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
            const open = stat.indexOf('(');
            const close = stat.lastIndexOf(')');
            const fields = stat.slice(close + 2).split(/\s+/);
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

function findTemperaturePath(): string | null {
    let iter: Gio.FileEnumerator | null = null;
    try {
        iter = Gio.File.new_for_path('/sys/class/hwmon').enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        for (let info = iter.next_file(null); info; info = iter.next_file(null)) {
            const dir = info.get_name();
            const name = readProcFile(`/sys/class/hwmon/${dir}/name`)?.trim();
            if (!name || !/^(coretemp|k10temp|zenpower)$/.test(name)) continue;
            let input: Gio.FileEnumerator | null = null;
            try {
                input = Gio.File.new_for_path(`/sys/class/hwmon/${dir}`).enumerate_children(
                    'standard::name',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                for (let child = input.next_file(null); child; child = input.next_file(null)) {
                    const filename = child.get_name();
                    if (!/^temp\d+_input$/.test(filename)) continue;
                    const labelPath = `/sys/class/hwmon/${dir}/${filename.replace('_input', '_label')}`;
                    const label = readProcFile(labelPath)?.trim() ?? '';
                    if (name === 'coretemp' && label && !/package/i.test(label)) continue;
                    return `/sys/class/hwmon/${dir}/${filename}`;
                }
            } finally {
                input?.close(null);
            }
        }
    } catch (e) {
        logger.warn('systemUsage', 'temperature sensor discovery failed:', e);
    } finally {
        iter?.close(null);
    }
    return null;
}


export default class SystemUsage {
    private static instance: SystemUsage;
    static get_default(): SystemUsage {
        if (!SystemUsage.instance) SystemUsage.instance = new SystemUsage();
        return SystemUsage.instance;
    }

    #lastCpuTop = new GTop.glibtop_cpu();
    #options: UsageOptions = {...DEFAULT_USAGE_OPTIONS};
    #tempPath: string | null = null;
    #tempFailed = false;
    #started = false;
    #bindCount = 0;
    #fastTimer: number | null = null;
    #slowTimer: number | null = null;
    #procTimer: number | null = null;
    #procSubscribers = 0;
    #lastProcTimes: Map<number, ProcTimes> | null = null;
    #lastTotalTicks = 0;
    #lastCores: CpuCounters[] = [];
    #lastNet: NetworkCounters | null = null;
    #lastNetTime = 0;
    #diskGeneration = 0;
    #diskCancellable: Gio.Cancellable | null = null;
    #cpu: Accessor<number>; #setCpu: (v: number) => void;
    #memory: Accessor<number>; #setMemory: (v: number) => void;
    #disk: Accessor<number>; #setDisk: (v: number) => void;
    #temp: Accessor<number>; #setTemp: (v: number) => void;
    #tempAvailable: Accessor<boolean>; #setTempAvailable: (v: boolean) => void;
    #cpuHistory: Accessor<number[]>; #setCpuHistory: (v: number[]) => void;
    #memoryHistory: Accessor<number[]>; #setMemoryHistory: (v: number[]) => void;
    #netRxHistory: Accessor<number[]>; #setNetRxHistory: (v: number[]) => void;
    #netTxHistory: Accessor<number[]>; #setNetTxHistory: (v: number[]) => void;
    #net: Accessor<NetRate>; #setNet: (v: NetRate) => void;
    #memoryBytes: Accessor<StorageUsage>; #setMemoryBytes: (v: StorageUsage) => void;
    #swapBytes: Accessor<StorageUsage>; #setSwapBytes: (v: StorageUsage) => void;
    #diskBytes: Accessor<StorageUsage>; #setDiskBytes: (v: StorageUsage) => void;
    #loadAverage: Accessor<[number, number, number]>; #setLoadAverage: (v: [number, number, number]) => void;
    #uptime: Accessor<number>; #setUptime: (v: number) => void;
    #topProcesses: Accessor<ProcessUsage[]>; #setTopProcesses: (v: ProcessUsage[]) => void;
    #cpuCores: Accessor<CpuCoreUsage[]>; #setCpuCores: (v: CpuCoreUsage[]) => void;
    #cpuModel: Accessor<string>; #setCpuModel: (v: string) => void;
    #cpuFrequencyMHz: Accessor<number | null>; #setCpuFrequencyMHz: (v: number | null) => void;
    #memoryDetails: Accessor<MemoryDetails | null>; #setMemoryDetails: (v: MemoryDetails | null) => void;
    #networkInterfaces: Accessor<string[]>; #setNetworkInterfaces: (v: string[]) => void;
    #netAvailable: Accessor<boolean>; #setNetAvailable: (v: boolean) => void;
    #diskAvailable: Accessor<boolean>; #setDiskAvailable: (v: boolean) => void;

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
        [this.#net, this.#setNet] = createState({rx: 0, tx: 0});
        [this.#memoryBytes, this.#setMemoryBytes] = createState({used: 0, total: 0});
        [this.#swapBytes, this.#setSwapBytes] = createState({used: 0, total: 0});
        [this.#diskBytes, this.#setDiskBytes] = createState({used: 0, total: 0});
        [this.#loadAverage, this.#setLoadAverage] = createState<[number, number, number]>([0, 0, 0]);
        [this.#uptime, this.#setUptime] = createState(0);
        [this.#topProcesses, this.#setTopProcesses] = createState<ProcessUsage[]>([]);
        [this.#cpuCores, this.#setCpuCores] = createState<CpuCoreUsage[]>([]);
        [this.#cpuModel, this.#setCpuModel] = createState('');
        [this.#cpuFrequencyMHz, this.#setCpuFrequencyMHz] = createState<number | null>(null);
        [this.#memoryDetails, this.#setMemoryDetails] = createState<MemoryDetails | null>(null);
        [this.#networkInterfaces, this.#setNetworkInterfaces] = createState<string[]>([]);
        [this.#netAvailable, this.#setNetAvailable] = createState(false);
        [this.#diskAvailable, this.#setDiskAvailable] = createState(false);
        const info = parseCpuInfo(readProcFile('/proc/cpuinfo') ?? '');
        this.#setCpuModel(info.model);
        this.#setCpuFrequencyMHz(info.frequencyMHz);
    }

    get cpu(): Accessor<number> { return this.#cpu; }
    get memory(): Accessor<number> { return this.#memory; }
    get disk(): Accessor<number> { return this.#disk; }
    get temp(): Accessor<number> { return this.#temp; }
    get tempAvailable(): Accessor<boolean> { return this.#tempAvailable; }
    get cpuHistory(): Accessor<number[]> { return this.#cpuHistory; }
    get memoryHistory(): Accessor<number[]> { return this.#memoryHistory; }
    get netRxHistory(): Accessor<number[]> { return this.#netRxHistory; }
    get netTxHistory(): Accessor<number[]> { return this.#netTxHistory; }
    get net(): Accessor<NetRate> { return this.#net; }
    get memoryBytes(): Accessor<StorageUsage> { return this.#memoryBytes; }
    get swapBytes(): Accessor<StorageUsage> { return this.#swapBytes; }
    get diskBytes(): Accessor<StorageUsage> { return this.#diskBytes; }
    get loadAverage(): Accessor<[number, number, number]> { return this.#loadAverage; }
    get uptime(): Accessor<number> { return this.#uptime; }
    get topProcesses(): Accessor<ProcessUsage[]> { return this.#topProcesses; }
    get cpuCores(): Accessor<CpuCoreUsage[]> { return this.#cpuCores; }
    get cpuModel(): Accessor<string> { return this.#cpuModel; }
    get cpuFrequencyMHz(): Accessor<number | null> { return this.#cpuFrequencyMHz; }
    get memoryDetails(): Accessor<MemoryDetails | null> { return this.#memoryDetails; }
    get networkInterfaces(): Accessor<string[]> { return this.#networkInterfaces; }
    get netAvailable(): Accessor<boolean> { return this.#netAvailable; }
    get diskAvailable(): Accessor<boolean> { return this.#diskAvailable; }

    configure(options: UsageOptions): void {
        if (Object.keys(options).every((key) => options[key as keyof UsageOptions] === this.#options[key as keyof UsageOptions])) return;
        const old = this.#options;
        this.#options = {...options};
        if (old.intervalMs !== options.intervalMs) {
            this.#lastNet = null; this.#lastCores = [];
            this.#setNet({rx: 0, tx: 0}); this.#setCpuCores([]);
            if (this.#fastTimer !== null) {
                GLib.source_remove(this.#fastTimer); this.#fastTimer = null;
                this.#resume();
            }
        }
        if (old.networkInterface !== options.networkInterface) {
            this.#lastNet = null; this.#setNet({rx: 0, tx: 0});
        }
        if (old.processSort !== options.processSort || old.processCount !== options.processCount)
            this.#setTopProcesses(sortProcesses(this.#topProcesses(), options.processSort, options.processCount));
        if (old.diskPath !== options.diskPath) this.#setDiskAvailable(false);
        if (old.tempPath !== options.tempPath) {
            this.#tempFailed = false;
            this.#tempPath = options.tempPath || findTemperaturePath();
            this.#setTempAvailable(false);
        }
        if (this.#started) this.#sampleSlow();
    }

    subscribeProcesses(): () => void {
        this.#procSubscribers++;
        if (this.#procSubscribers === 1) {
            this.#sampleProcesses();
            this.#procTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_PROCESSES, () => {
                this.#sampleProcesses(); return GLib.SOURCE_CONTINUE;
            });
        }
        let active = true;
        return () => {
            if (!active) return;
            active = false; this.#procSubscribers--;
            if (this.#procSubscribers > 0 || this.#procTimer === null) return;
            GLib.source_remove(this.#procTimer); this.#procTimer = null; this.#lastProcTimes = null;
        };
    }

    #sampleProcesses(): void {
        const aggregate = readProcFile('/proc/stat')?.split('\n', 1)[0];
        const totalTicks = aggregate?.trim().split(/\s+/).slice(1).reduce((sum, value) => sum + (Number(value) || 0), 0) ?? 0;
        const times = readProcessTimes();
        const previous = this.#lastProcTimes;
        const elapsed = totalTicks - this.#lastTotalTicks;
        this.#lastProcTimes = times; this.#lastTotalTicks = totalTicks;
        if (!previous || elapsed <= 0) return;
        const usage: ProcessUsage[] = [];
        for (const [pid, t] of times) {
            const before = previous.get(pid);
            usage.push({pid, name: t.name, cpu: Math.max(0, before ? t.ticks - before.ticks : 0) / elapsed, rss: t.rss});
        }
        this.#setTopProcesses(sortProcesses(usage, this.#options.processSort, this.#options.processCount));
    }

    launchMonitor(cmd: string): void {
        Process.execAsync(cmd).catch((e) => logger.error('systemUsage', 'failed to launch monitor:', e));
    }
    init(userTempPath?: string): void {
        if (userTempPath !== undefined) this.configure({...this.#options, tempPath: userTempPath});
        this.start();
    }
    subscribe(): () => void {
        this.#bindCount++;
        if (this.#bindCount === 1) this.#resume();
        let active = true;
        return () => {
            if (!active) return;
            active = false; this.#bindCount = Math.max(0, this.#bindCount - 1);
            if (this.#bindCount === 0) this.#pause();
        };
    }
    start(userTempPath?: string): void {
        if (userTempPath !== undefined) this.configure({...this.#options, tempPath: userTempPath});
        if (this.#started) return;
        this.#started = true;
        this.#tempPath = this.#options.tempPath || findTemperaturePath();
        this.#resume();
    }
    #resume(): void {
        if (this.#fastTimer !== null || this.#bindCount === 0) return;
        this.#sample();
        this.#fastTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.#options.intervalMs, () => {
            this.#sampleFast(); return GLib.SOURCE_CONTINUE;
        });
        this.#slowTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SLOW, () => {
            this.#sampleSlow(); return GLib.SOURCE_CONTINUE;
        });
    }
    #pause(): void {
        if (this.#fastTimer !== null) { GLib.source_remove(this.#fastTimer); this.#fastTimer = null; }
        if (this.#slowTimer !== null) { GLib.source_remove(this.#slowTimer); this.#slowTimer = null; }
    }
    #sampleFast(): void {
        const cpuTop = new GTop.glibtop_cpu(); glibtop_get_cpu(cpuTop);
        const total = cpuTop.total - this.#lastCpuTop.total;
        const cpu = (cpuTop.user - this.#lastCpuTop.user + cpuTop.sys - this.#lastCpuTop.sys + cpuTop.nice - this.#lastCpuTop.nice) / (total || 1);
        this.#lastCpuTop = cpuTop;
        this.#setCpu(Math.max(0, cpu)); this.#setCpuHistory(pushHistory(this.#cpuHistory(), Math.max(0, cpu)));
        const cores = parseCpuCounters(readProcFile('/proc/stat') ?? '');
        if (this.#lastCores.length) this.#setCpuCores(calculateCoreUsage(this.#lastCores, cores));
        this.#lastCores = cores;
        const memTop = new GTop.glibtop_mem(); glibtop_get_mem(memTop);
        const memory = memTop.user / (memTop.total || 1);
        this.#setMemory(memory); this.#setMemoryHistory(pushHistory(this.#memoryHistory(), memory));
        this.#setMemoryBytes({used: memTop.user, total: memTop.total});
        const memInfo = readProcFile('/proc/meminfo');
        this.#setMemoryDetails(memInfo ? parseMemoryDetails(memInfo) : null);
        const parsed = parseNetworkCounters(readProcFile('/proc/net/dev') ?? '', this.#options.networkInterface);
        this.#setNetworkInterfaces(parsed.interfaces); this.#setNetAvailable(parsed.counters !== null);
        const now = GLib.get_monotonic_time();
        if (parsed.counters && this.#lastNet) {
            const seconds = (now - this.#lastNetTime) / 1_000_000;
            const reset = parsed.counters.rx < this.#lastNet.rx || parsed.counters.tx < this.#lastNet.tx;
            const rate = reset || seconds <= 0 ? {rx: 0, tx: 0} : {
                rx: (parsed.counters.rx - this.#lastNet.rx) / seconds,
                tx: (parsed.counters.tx - this.#lastNet.tx) / seconds,
            };
            this.#setNet(rate); this.#setNetRxHistory(pushHistory(this.#netRxHistory(), rate.rx));
            this.#setNetTxHistory(pushHistory(this.#netTxHistory(), rate.tx));
        } else if (!parsed.counters) this.#setNet({rx: 0, tx: 0});
        this.#lastNet = parsed.counters; this.#lastNetTime = now;
    }
    #requestDisk(): void {
        this.#diskCancellable?.cancel();
        const cancellable = new Gio.Cancellable(); this.#diskCancellable = cancellable;
        const generation = ++this.#diskGeneration;
        const file = Gio.File.new_for_path(this.#options.diskPath);
        file.query_filesystem_info_async(
            'filesystem::size,filesystem::free', GLib.PRIORITY_DEFAULT, cancellable,
            (_source, result) => {
                if (generation !== this.#diskGeneration) return;
                try {
                    const info = file.query_filesystem_info_finish(result);
                    const total = info.get_attribute_uint64('filesystem::size');
                    const free = info.get_attribute_uint64('filesystem::free');
                    const used = total - free;
                    this.#setDiskBytes({used, total}); this.#setDisk(total > 0 ? used / total : 0);
                    this.#setDiskAvailable(total > 0);
                } catch { this.#setDiskAvailable(false); }
            }
        );
    }
    #sampleSlow(): void {
        this.#requestDisk();
        const swapTop = new GTop.glibtop_swap(); glibtop_get_swap(swapTop);
        this.#setSwapBytes({used: swapTop.used, total: swapTop.total});
        const load = readProcFile('/proc/loadavg')?.split(' ');
        if (load) this.#setLoadAverage([Number(load[0]), Number(load[1]), Number(load[2])]);
        const uptime = readProcFile('/proc/uptime');
        if (uptime) this.#setUptime(Number(uptime.split(' ')[0]));
        if (!this.#tempPath || this.#tempFailed) return;
        try {
            const [success, contents] = Gio.File.new_for_path(this.#tempPath).load_contents(null);
            if (!success) throw new Error('sensor read failed');
            const value = Number.parseInt(new TextDecoder().decode(contents), 10);
            if (!Number.isFinite(value)) throw new Error('sensor value invalid');
            this.#setTemp(value / TEMP_TO_LEVELBAR); this.#setTempAvailable(true);
        } catch (e) {
            logger.warn('systemUsage', 'failed to read temperature:', e);
            this.#setTempAvailable(false);
            if (this.#options.tempPath) this.#tempFailed = true;
        }
    }
    #sample(): void { this.#sampleFast(); this.#sampleSlow(); }
}

defineService({
    name: 'SystemUsage',
    service: SystemUsage.get_default(),
    initArgs: () => [barSettings().tempPath()],
});
