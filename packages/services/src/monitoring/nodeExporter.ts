import type {CpuCoreUsage, MemoryDetails, NetRate, StorageUsage} from './systemUsage';

export interface NodeExporterSample {
    hostname: string;
    cpu: CpuCounter[];
    memoryTotal: number;
    memoryAvailable: number;
    memoryDetails: MemoryDetails | null;
    swapTotal: number | null;
    swapFree: number | null;
    networkInterfaces: string[];
    network: Record<string, {rx: number; tx: number}>;
    filesystem: Record<string, StorageUsage>;
    temperatures: number[];
    loadAverage: [number, number, number] | null;
    uptime: number | null;
    cpuModel: string;
    cpuFrequencyMHz: number | null;
}

export interface CpuCounter { id: number; total: number; idle: number }
export interface DerivedSample { cpu: number; cpuCores: CpuCoreUsage[]; net: NetRate | null; ratesReady: boolean }

function labels(text: string): Record<string, string> {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
    let match: RegExpExecArray | null;
    while (true) {
        match = pattern.exec(text);
        if (!match) break;
        result[match[1]] = match[2].replace(/\\(["\\n])/g, (_escape, value: string) => value === 'n' ? '\n' : value);
    }
    return result;
}

/** Parse Prometheus exposition, retaining only metrics node_exporter exports. */
export function parseNodeExporter(text: string): NodeExporterSample | null {
    const cpus = new Map<number, Record<string, number>>();
    const network: Record<string, {rx: number; tx: number}> = Object.create(null) as Record<string, {rx: number; tx: number}>;
    const filesystem: Record<string, StorageUsage> = Object.create(null) as Record<string, StorageUsage>;
    const temperatures: number[] = [];
    const memory: Record<string, number> = Object.create(null) as Record<string, number>;
    const load: Partial<Record<1 | 5 | 15, number>> = {};
    const frequencies: number[] = [];
    let hostname = '';
    let bootTime: number | null = null, currentTime: number | null = null, cpuModel = '';
    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('node_')) continue;
        const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|NaN|[+-]?Inf)(?:\s+-?(?:\d+(?:\.\d*)?|\.\d+))?$/.exec(line);
        if (!match) continue;
        const name = match[1], value = Number(match[3]);
        if (!Number.isFinite(value)) continue;
        const tag = name === 'node_cpu_seconds_total' || name === 'node_uname_info' ||
            name === 'node_network_receive_bytes_total' || name === 'node_network_transmit_bytes_total' ||
            name === 'node_filesystem_size_bytes' || name === 'node_filesystem_avail_bytes' ||
            name === 'node_cpu_info' ? labels(match[2] ?? '') : Object.create(null) as Record<string, string>;
        if (name === 'node_uname_info') hostname = tag.nodename ?? hostname;
        else if (name === 'node_cpu_seconds_total') {
            const id = Number(tag.cpu), mode = tag.mode;
            if (!Number.isInteger(id) || id < 0 || !mode || mode === 'guest' || mode === 'guest_nice') continue;
            let modes = cpus.get(id);
            if (!modes) { modes = {}; cpus.set(id, modes); }
            modes[mode] = value;
        } else if (name.startsWith('node_memory_')) memory[name.slice('node_memory_'.length)] = value;
        else if (name === 'node_network_receive_bytes_total' || name === 'node_network_transmit_bytes_total') {
            const dev = tag.device;
            if (!dev) continue;
            let row = network[dev];
            if (!row) { row = {rx: -1, tx: -1}; network[dev] = row; }
            if (name.endsWith('receive_bytes_total')) row.rx = value;
            else row.tx = value;
        } else if (name === 'node_filesystem_size_bytes' || name === 'node_filesystem_avail_bytes') {
            const mount = tag.mountpoint;
            if (!mount || tag.fstype === 'rootfs' || tag.device === 'rootfs') continue;
            let row = filesystem[mount];
            if (!row) { row = {used: -1, total: -1}; filesystem[mount] = row; }
            if (name.endsWith('size_bytes')) row.total = value;
            else row.used = value;
        } else if (name === 'node_hwmon_temp_celsius') temperatures.push(value);
        else if (name === 'node_load1' || name === 'node_load5' || name === 'node_load15') {
            const period = Number(name.slice('node_load'.length)) as 1 | 5 | 15;
            load[period] = value;
        } else if (name === 'node_boot_time_seconds') bootTime = value;
        else if (name === 'node_time_seconds') currentTime = value;
        else if (name === 'node_cpu_info') cpuModel = tag.model_name ?? cpuModel;
        else if (name === 'node_cpu_scaling_frequency_hertz') frequencies.push(value / 1e6);
    }
    const cpu = [...cpus.entries()].sort(([a], [b]) => a - b).flatMap(([id, modes]) => {
        if (modes.idle === undefined || Object.keys(modes).length < 2) return [];
        return [{id, idle: modes.idle + (modes.iowait ?? 0), total: Object.values(modes).reduce((sum, value) => sum + value, 0)}];
    });
    const memoryTotal = memory.MemTotal_bytes ?? 0;
    const memoryAvailable = memory.MemAvailable_bytes ?? -1;
    if (cpu.length === 0 || !(memoryTotal > 0) || !(memoryAvailable >= 0)) return null;
    const loadAverage: [number, number, number] | null = load[1] !== undefined && load[5] !== undefined && load[15] !== undefined
        ? [load[1], load[5], load[15]] : null;
    const uptime = bootTime !== null && currentTime !== null ? Math.max(0, currentTime - bootTime) : null;
    const memoryDetails = memory.MemFree_bytes !== undefined && memory.Cached_bytes !== undefined &&
        memory.SReclaimable_bytes !== undefined
        ? {available: memoryAvailable, free: memory.MemFree_bytes,
            cached: memory.Cached_bytes + memory.SReclaimable_bytes} : null;
    return {hostname, cpu, memoryTotal, memoryAvailable, memoryDetails,
        swapTotal: memory.SwapTotal_bytes ?? null, swapFree: memory.SwapFree_bytes ?? null,
        networkInterfaces: Object.keys(network).filter((name) => network[name].rx >= 0 && network[name].tx >= 0).sort(),
        network: Object.fromEntries(Object.entries(network).filter(([, counters]) => counters.rx >= 0 && counters.tx >= 0)),
        filesystem: Object.fromEntries(Object.entries(filesystem).flatMap(([path, usage]) =>
            usage.total > 0 && usage.used >= 0 ? [[path, {used: Math.max(0, usage.total - usage.used), total: usage.total}]] : [])),
        temperatures, loadAverage, uptime, cpuModel,
        cpuFrequencyMHz: frequencies.length
            ? frequencies.reduce((sum, frequency) => sum + frequency, 0) / frequencies.length : null};
}

export function deriveNodeExporterRates(previous: NodeExporterSample | null, current: NodeExporterSample,
    elapsedSeconds: number, networkInterface: string, networkPrevious: NodeExporterSample | null = previous): DerivedSample {
    const empty: DerivedSample = {cpu: 0, cpuCores: [], net: null, ratesReady: false};
    if (!previous || previous.hostname !== current.hostname || !(elapsedSeconds > 0)) return empty;
    const oldCpu = new Map(previous.cpu.map((core) => [core.id, core]));
    const cpuCores: CpuCoreUsage[] = [];
    for (const core of current.cpu) {
        const old = oldCpu.get(core.id);
        const total = old ? core.total - old.total : 0;
        const idle = old ? core.idle - old.idle : -1;
        if (total <= 0 || idle < 0 || idle > total) return empty;
        cpuCores.push({id: core.id, usage: Math.max(0, Math.min(1, (total - idle) / total))});
    }
    if (cpuCores.length !== current.cpu.length || !cpuCores.length) return empty;
    const currentNames = networkInterface ? [networkInterface] : current.networkInterfaces.filter((name) => name !== 'lo');
    const oldNames = networkInterface ? [networkInterface] : (networkPrevious?.networkInterfaces ?? []).filter((name) => name !== 'lo');
    let net: NetRate | null = null;
    if (currentNames.length && currentNames.length === oldNames.length && currentNames.every((name) => oldNames.includes(name))) {
        let rx = 0, tx = 0, valid = true;
        for (const name of currentNames) {
            const now = current.network[name], before = networkPrevious?.network[name];
            if (!now || !before || now.rx < before.rx || now.tx < before.tx) { valid = false; break; }
            rx += (now.rx - before.rx) / elapsedSeconds;
            tx += (now.tx - before.tx) / elapsedSeconds;
        }
        if (valid) net = {rx, tx};
    }
    return {cpu: cpuCores.reduce((sum, core) => sum + core.usage, 0) / cpuCores.length,
        cpuCores, net, ratesReady: true};
}
