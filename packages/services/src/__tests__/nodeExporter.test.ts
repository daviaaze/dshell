import {deriveNodeExporterRates, parseNodeExporter} from '../monitoring/nodeExporter';
import {describe, expect, it, run} from './test-runner';

const sample = (cpu: string, rx: number, hostname = 'host', memAvailable = 40) => `
node_uname_info{nodename="${hostname}"} 1
node_cpu_seconds_total{cpu="0",mode="user"} ${cpu}
node_cpu_seconds_total{cpu="0",mode="idle"} ${100 + Number(cpu)}
node_cpu_seconds_total{cpu="0",mode="iowait"} 5
node_cpu_seconds_total{cpu="0",mode="guest"} 99999
node_memory_MemTotal_bytes 100
node_memory_MemAvailable_bytes ${memAvailable}
node_memory_SwapTotal_bytes 0
node_memory_SwapFree_bytes 0
node_network_receive_bytes_total{device="enp1s0"} ${rx}
node_network_transmit_bytes_total{device="enp1s0"} ${rx * 2}
node_filesystem_size_bytes{device="/dev/root",mountpoint="/",fstype="ext4"} 1000
node_filesystem_avail_bytes{device="/dev/root",mountpoint="/",fstype="ext4"} 250
node_hwmon_temp_celsius{chip="coretemp",sensor="temp1",label="CPU \\nPackage"} 72.5
node_load1 0.5
node_load5 0.4
node_load15 0.3
node_boot_time_seconds 1000
node_time_seconds 1100
node_cpu_scaling_frequency_hertz{cpu="0"} 2000000000
node_cpu_scaling_frequency_hertz{cpu="1"} 4000000000
`;

describe('node_exporter parser and rates', () => {
    it('parses capabilities, escaped labels, CPU IDs and excludes guest counters', () => {
        const parsed = parseNodeExporter(sample('20', 100));
        expect(parsed?.hostname).toBe('host');
        expect(parsed?.cpu.map(({id, total, idle}) => [id, total, idle])).toEqual([[0, 145, 125]]);
        expect(parsed?.memoryTotal).toBe(100);
        expect(parsed?.filesystem['/'].used).toBe(750);
        expect(parsed?.filesystem['/'].total).toBe(1000);
        const escaped = parseNodeExporter(sample('20', 100, String.raw`host\\node\nname`));
        expect(escaped?.hostname).toBe('host\\node\nname');
        expect(parsed?.temperatures).toEqual([72.5]);
        expect(parsed?.loadAverage).toEqual([0.5, 0.4, 0.3]);
        expect(parsed?.uptime).toBe(100);
        expect(parsed?.cpuFrequencyMHz).toBe(3000);
        expect(parseNodeExporter('node_memory_MemTotal_bytes 10')).toBe(null);
    });
    it('requires a baseline, computes per-core and network counter deltas, and detects resets/host change', () => {
        const first = parseNodeExporter(sample('20', 100));
        const next = parseNodeExporter(sample('30', 160));
        if (!first || !next) throw new Error('fixture should parse');
        expect(deriveNodeExporterRates(null, first, 5, 'enp1s0').ratesReady).toBe(false);
        expect(deriveNodeExporterRates(first, next, 2, 'enp1s0')).toEqual({
            cpu: 0.5, cpuCores: [{id: 0, usage: 0.5}], net: {rx: 30, tx: 60}, ratesReady: true,
        });
        const reset = parseNodeExporter(sample('1', 5));
        if (!reset) throw new Error('fixture should parse');
        expect(deriveNodeExporterRates(next, reset, 2, 'enp1s0').ratesReady).toBe(false);
        const networkReset = parseNodeExporter(sample('40', 5));
        if (!networkReset) throw new Error('fixture should parse');
        const resetRates = deriveNodeExporterRates(next, networkReset, 2, 'enp1s0');
        expect(resetRates.ratesReady).toBe(true);
        expect(resetRates.cpu).toBe(0.5);
        expect(resetRates.net).toBe(null);
        const unavailableNetwork = deriveNodeExporterRates(first, next, 2, 'missing');
        expect(unavailableNetwork.ratesReady).toBe(true);
        expect(unavailableNetwork.cpu).toBe(0.5);
        expect(unavailableNetwork.net).toBe(null);
        const otherHost = parseNodeExporter(sample('30', 160, 'other'));
        if (!otherHost) throw new Error('fixture should parse');
        expect(deriveNodeExporterRates(first, otherHost, 2, 'enp1s0').ratesReady).toBe(false);
    });
});

await run(import.meta.url);
