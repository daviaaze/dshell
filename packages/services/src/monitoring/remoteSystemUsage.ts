import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {createState, type Accessor} from 'gnim';
import type {CpuCoreUsage, MemoryDetails, NetRate, StorageUsage} from './systemUsage';
import {deriveNodeExporterRates, parseNodeExporter, type NodeExporterSample} from './nodeExporter';

export interface RemoteUsageOptions {
    url: string;
    intervalMs: number;
    networkInterface: string;
    diskPath: string;
}
type ConnectionState = 'idle' | 'connecting' | 'ready' | 'error';
const HISTORY_LENGTH = 60;
const DEFAULT_OPTIONS: RemoteUsageOptions = {
    url: '',
    intervalMs: 5000,
    networkInterface: '',
    diskPath: '/',
};

export default class RemoteSystemUsage {
    static #instance: RemoteSystemUsage | null = null;
    static get_default(): RemoteSystemUsage {
        if (!RemoteSystemUsage.#instance) RemoteSystemUsage.#instance = new RemoteSystemUsage();
        return RemoteSystemUsage.#instance;
    }

    #options: RemoteUsageOptions = {...DEFAULT_OPTIONS};
    #subscribers = 0;
    #generation = 0;
    #timer: number | null = null;
    #cancellable: Gio.Cancellable | null = null;
    #session: Soup.Session;
    #inFlight = false;
    #previous: NodeExporterSample | null = null;
    #networkPrevious: NodeExporterSample | null = null;
    #previousAt = 0;
    #lastHost = '';
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
    #cpuCores: Accessor<CpuCoreUsage[]>;
    #setCpuCores: (v: CpuCoreUsage[]) => void;
    #cpuModel: Accessor<string>;
    #setCpuModel: (v: string) => void;
    #cpuFrequencyMHz: Accessor<number | null>;
    #setCpuFrequencyMHz: (v: number | null) => void;
    #memoryDetails: Accessor<MemoryDetails | null>;
    #setMemoryDetails: (v: MemoryDetails | null) => void;
    #networkInterfaces: Accessor<string[]>;
    #setNetworkInterfaces: (v: string[]) => void;
    #netAvailable: Accessor<boolean>;
    #setNetAvailable: (v: boolean) => void;
    #diskAvailable: Accessor<boolean>;
    #setDiskAvailable: (v: boolean) => void;
    #state: Accessor<ConnectionState>;
    #setState: (v: ConnectionState) => void;
    #error: Accessor<string>;
    #setError: (v: string) => void;
    #hostname: Accessor<string>;
    #setHostname: (v: string) => void;
    #updatedAt: Accessor<number>;
    #setUpdatedAt: (v: number) => void;
    #hasSample: Accessor<boolean>;
    #setHasSample: (v: boolean) => void;
    #ratesReady: Accessor<boolean>;
    #setRatesReady: (v: boolean) => void;
    #tempDescription: Accessor<string>;
    #setTempDescription: (v: string) => void;

    constructor() {
        this.#session = new Soup.Session({timeout: 3});
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
        [this.#loadAverage, this.#setLoadAverage] = createState<[number, number, number]>([
            0, 0, 0,
        ]);
        [this.#uptime, this.#setUptime] = createState(0);
        [this.#cpuCores, this.#setCpuCores] = createState<CpuCoreUsage[]>([]);
        [this.#cpuModel, this.#setCpuModel] = createState('');
        [this.#cpuFrequencyMHz, this.#setCpuFrequencyMHz] = createState<number | null>(null);
        [this.#memoryDetails, this.#setMemoryDetails] = createState<MemoryDetails | null>(null);
        [this.#networkInterfaces, this.#setNetworkInterfaces] = createState<string[]>([]);
        [this.#netAvailable, this.#setNetAvailable] = createState(false);
        [this.#diskAvailable, this.#setDiskAvailable] = createState(false);
        [this.#state, this.#setState] = createState<ConnectionState>('idle');
        [this.#error, this.#setError] = createState('');
        [this.#hostname, this.#setHostname] = createState('');
        [this.#updatedAt, this.#setUpdatedAt] = createState(0);
        [this.#hasSample, this.#setHasSample] = createState(false);
        [this.#ratesReady, this.#setRatesReady] = createState(false);
        [this.#tempDescription, this.#setTempDescription] = createState('');
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
    get cpuHistory(): Accessor<number[]> {
        return this.#cpuHistory;
    }
    get memoryHistory(): Accessor<number[]> {
        return this.#memoryHistory;
    }
    get netRxHistory(): Accessor<number[]> {
        return this.#netRxHistory;
    }
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
    get loadAverage(): Accessor<[number, number, number]> {
        return this.#loadAverage;
    }
    get uptime(): Accessor<number> {
        return this.#uptime;
    }
    get cpuCores(): Accessor<CpuCoreUsage[]> {
        return this.#cpuCores;
    }
    get cpuModel(): Accessor<string> {
        return this.#cpuModel;
    }
    get cpuFrequencyMHz(): Accessor<number | null> {
        return this.#cpuFrequencyMHz;
    }
    get memoryDetails(): Accessor<MemoryDetails | null> {
        return this.#memoryDetails;
    }
    get networkInterfaces(): Accessor<string[]> {
        return this.#networkInterfaces;
    }
    get netAvailable(): Accessor<boolean> {
        return this.#netAvailable;
    }
    get diskAvailable(): Accessor<boolean> {
        return this.#diskAvailable;
    }
    get state(): Accessor<ConnectionState> {
        return this.#state;
    }
    get error(): Accessor<string> {
        return this.#error;
    }
    get hostname(): Accessor<string> {
        return this.#hostname;
    }
    get updatedAt(): Accessor<number> {
        return this.#updatedAt;
    }
    get hasSample(): Accessor<boolean> {
        return this.#hasSample;
    }
    get ratesReady(): Accessor<boolean> {
        return this.#ratesReady;
    }
    get tempDescription(): Accessor<string> {
        return this.#tempDescription;
    }

    configure(options: RemoteUsageOptions): void {
        const next = {...options, intervalMs: Math.max(2000, Math.min(60000, options.intervalMs))};
        if (
            Object.keys(next).every(
                (key) =>
                    next[key as keyof RemoteUsageOptions] ===
                    this.#options[key as keyof RemoteUsageOptions]
            )
        )
            return;
        const oldOptions = this.#options;
        const urlChanged = next.url !== oldOptions.url;
        const interfaceChanged = next.networkInterface !== oldOptions.networkInterface;
        this.#options = next;
        ++this.#generation;
        this.#cancelRequest();
        if (urlChanged) this.#clearSample();
        else if (interfaceChanged) {
            this.#networkPrevious = null;
            this.#clearNetwork();
        }
        if (next.diskPath !== oldOptions.diskPath) this.#setDiskAvailable(false);
        if (this.#subscribers) {
            this.#removeTimer();
            this.#schedule(0);
        }
    }

    subscribe(): () => void {
        this.#subscribers++;
        if (this.#subscribers === 1) this.#schedule(0);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.#subscribers = Math.max(0, this.#subscribers - 1);
            if (!this.#subscribers) {
                ++this.#generation;
                this.#removeTimer();
                this.#cancelRequest();
                this.#setState('idle');
            }
        };
    }

    #clearNetwork(): void {
        this.#setNet({rx: 0, tx: 0});
        this.#setNetAvailable(false);
        this.#setNetRxHistory([]);
        this.#setNetTxHistory([]);
    }

    #clearSample(): void {
        this.#previous = null;
        this.#networkPrevious = null;
        this.#previousAt = 0;
        this.#lastHost = '';
        this.#setCpu(0);
        this.#setMemory(0);
        this.#setDisk(0);
        this.#setTemp(0);
        this.#setTempAvailable(false);
        this.#setCpuHistory([]);
        this.#setMemoryHistory([]);
        this.#clearNetwork();
        this.#setMemoryBytes({used: 0, total: 0});
        this.#setSwapBytes({used: 0, total: 0});
        this.#setDiskBytes({used: 0, total: 0});
        this.#setLoadAverage([0, 0, 0]);
        this.#setUptime(0);
        this.#setCpuCores([]);
        this.#setCpuModel('');
        this.#setCpuFrequencyMHz(null);
        this.#setMemoryDetails(null);
        this.#setNetworkInterfaces([]);
        this.#setDiskAvailable(false);
        this.#setHostname('');
        this.#setUpdatedAt(0);
        this.#setHasSample(false);
        this.#setRatesReady(false);
        this.#setTempDescription('');
        this.#setError('');
        this.#setState('idle');
    }

    #removeTimer(): void {
        if (this.#timer === null) return;
        GLib.source_remove(this.#timer);
        this.#timer = null;
    }

    #cancelRequest(): void {
        this.#cancellable?.cancel();
        this.#cancellable = null;
        this.#inFlight = false;
    }
    #schedule(delay: number): void {
        if (!this.#subscribers || this.#timer !== null || this.#inFlight) return;
        this.#timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, delay), () => {
            this.#timer = null;
            this.#fetch();
            return GLib.SOURCE_REMOVE;
        });
    }

    #fetch(): void {
        if (!this.#subscribers || this.#inFlight) return;
        let uri: GLib.Uri;
        try {
            uri = GLib.Uri.parse(this.#options.url.trim(), GLib.UriFlags.NONE);
            if (
                !['http', 'https'].includes(uri.get_scheme() ?? '') ||
                !uri.get_host() ||
                uri.get_userinfo()
            )
                throw new Error('Use uma URL HTTP(S) válida, sem credenciais.');
        } catch (error) {
            this.#fail(error instanceof Error ? error.message : 'URL inválida.');
            this.#schedule(this.#options.intervalMs);
            return;
        }
        const generation = this.#generation;
        const cancellable = new Gio.Cancellable();
        this.#cancellable = cancellable;
        this.#inFlight = true;
        if (!this.#hasSample() && this.#state() !== 'error') this.#setState('connecting');
        const message = Soup.Message.new('GET', this.#options.url.trim());
        if (!message) {
            this.#inFlight = false;
            this.#fail('URL HTTP(S) inválida.');
            this.#schedule(this.#options.intervalMs);
            return;
        }
        this.#session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_session, result) => {
                let body: string | null = null,
                    failure = '';
                try {
                    const bytes = this.#session.send_and_read_finish(result);
                    const status = message.get_status();
                    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
                    body = new TextDecoder().decode(bytes.get_data());
                } catch (error) {
                    failure = error instanceof Error ? error.message : 'Falha na consulta HTTP.';
                }
                if (generation !== this.#generation || !this.#subscribers) return;
                this.#inFlight = false;
                this.#cancellable = null;
                this.#handleBody(body, failure);
                this.#schedule(this.#options.intervalMs);
            }
        );
    }

    /** Apply a fetched body; a throwing parser or apply must surface as an error state, not stop polling. */
    #handleBody(body: string | null, failure: string): void {
        try {
            if (body === null) {
                this.#fail(failure);
                return;
            }
            const sample = parseNodeExporter(body);
            if (sample) this.#apply(sample);
            else this.#fail('Resposta node_exporter sem métricas obrigatórias de CPU/RAM.');
        } catch (error) {
            this.#fail(error instanceof Error ? error.message : 'Falha ao processar as métricas.');
        }
    }

    #fail(message: string): void {
        this.#setState('error');
        this.#setError(message);
    }

    #apply(sample: NodeExporterSample): void {
        const hostChanged =
            !!this.#lastHost && !!sample.hostname && sample.hostname !== this.#lastHost;
        const previousUptime = this.#previous?.uptime;
        const rebooted =
            previousUptime !== null &&
            previousUptime !== undefined &&
            sample.uptime !== null &&
            sample.uptime < previousUptime;
        if (hostChanged || rebooted) this.#clearSample();
        const updatedAt = Date.now();
        const monotonicNow = GLib.get_monotonic_time() / 1_000_000;
        const elapsedSeconds = monotonicNow - this.#previousAt;
        const derived = deriveNodeExporterRates(
            this.#previous,
            sample,
            elapsedSeconds,
            this.#options.networkInterface,
            this.#networkPrevious
        );
        if (derived.ratesReady) {
            this.#setCpu(derived.cpu);
            this.#setCpuCores(derived.cpuCores);
            this.#setCpuHistory([...this.#cpuHistory(), derived.cpu].slice(-HISTORY_LENGTH));
        } else if (this.#previous) {
            this.#setCpu(0);
            this.#setCpuCores([]);
            this.#setCpuHistory([]);
        }
        this.#setRatesReady(derived.ratesReady);
        if (derived.net) {
            this.#setNet(derived.net);
            this.#setNetAvailable(true);
            this.#setNetRxHistory([...this.#netRxHistory(), derived.net.rx].slice(-HISTORY_LENGTH));
            this.#setNetTxHistory([...this.#netTxHistory(), derived.net.tx].slice(-HISTORY_LENGTH));
        } else this.#clearNetwork();
        const used = Math.max(0, sample.memoryTotal - sample.memoryAvailable);
        const memoryUsage = used / sample.memoryTotal;
        this.#setMemory(memoryUsage);
        this.#setMemoryHistory([...this.#memoryHistory(), memoryUsage].slice(-HISTORY_LENGTH));
        this.#setMemoryBytes({used, total: sample.memoryTotal});
        this.#setMemoryDetails(sample.memoryDetails);
        this.#setSwapBytes(
            sample.swapTotal !== null && sample.swapFree !== null
                ? {used: Math.max(0, sample.swapTotal - sample.swapFree), total: sample.swapTotal}
                : {used: 0, total: 0}
        );
        const disk = sample.filesystem[this.#options.diskPath];
        this.#setDiskAvailable(!!disk && disk.total > 0);
        if (disk && disk.total > 0) {
            this.#setDiskBytes(disk);
            this.#setDisk(disk.used / disk.total);
        } else {
            this.#setDiskBytes({used: 0, total: 0});
            this.#setDisk(0);
        }
        const temperature = sample.temperatures.length ? Math.max(...sample.temperatures) : null;
        this.#setTempAvailable(temperature !== null);
        this.#setTemp(temperature === null ? 0 : temperature / 100);
        this.#setTempDescription(
            temperature === null ? '' : 'Maior temperatura de sensor exportada'
        );
        this.#setLoadAverage(sample.loadAverage ?? [0, 0, 0]);
        this.#setUptime(sample.uptime ?? 0);
        this.#setCpuModel(sample.cpuModel);
        this.#setCpuFrequencyMHz(sample.cpuFrequencyMHz);
        this.#setNetworkInterfaces(sample.networkInterfaces);
        this.#setHostname(sample.hostname);
        this.#setUpdatedAt(updatedAt);
        this.#setHasSample(true);
        this.#setError('');
        this.#setState('ready');
        this.#previous = sample;
        this.#networkPrevious = sample;
        this.#previousAt = monotonicNow;
        this.#lastHost = sample.hostname;
    }
}
