import GTop from 'gi://GTop';

/* eslint-disable camelcase -- wrapper names intentionally mirror the libgtop C API */
// GIR does not capture these raw C functions — typed wrappers around them.
const glibtop_get_cpu = (buffer: GTop.glibtop_cpu): void =>
    (GTop as unknown as {glibtop_get_cpu: (b: GTop.glibtop_cpu) => void}).glibtop_get_cpu(buffer);
const glibtop_get_mem = (buffer: GTop.glibtop_mem): void =>
    (GTop as unknown as {glibtop_get_mem: (b: GTop.glibtop_mem) => void}).glibtop_get_mem(buffer);
const glibtop_get_fsusage = (buffer: GTop.glibtop_fsusage, path: string): void =>
    (GTop as unknown as {glibtop_get_fsusage: (b: GTop.glibtop_fsusage, p: string) => void}).glibtop_get_fsusage(buffer, path);
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Accessor, createState} from 'gnim';
import logger from '../../core/logger';
import {Process} from '../../core/process';

const POLL_INTERVAL = 1000;
/** hwmon temp1_input is millidegrees. Divide by 1000 for °C, then 100 maps to 0..1. */
const TEMP_TO_LEVELBAR = 100000;

/** Auto-discover the coretemp Package id 0 sensor path. */
function findCoretempPath(): string | null {
    const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon');
    let iter: Gio.FileEnumerator | null = null;
    try {
        iter = hwmonDir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info: Gio.FileInfo | null;
        while ((info = iter.next_file(null)) !== null) {
            const hwmonName = info.get_name();
            const nameFile = iter.get_child(info).get_child('name');
            try {
                const [ok, contents] = nameFile.load_contents(null);
                if (
                    ok &&
                    new TextDecoder().decode(contents).trim() === 'coretemp'
                ) {
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
        if (!this.instance) this.instance = new SystemUsage();
        return this.instance;
    }

    #lastCpuTop = new GTop.glibtop_cpu();
    #tempPath: string | null = null;
    #tempFailed = false;
    #started = false;

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

    constructor() {
        [this.#cpu, this.#setCpu] = createState(0);
        [this.#memory, this.#setMemory] = createState(0);
        [this.#disk, this.#setDisk] = createState(0);
        [this.#temp, this.#setTemp] = createState(0);
        [this.#tempAvailable, this.#setTempAvailable] = createState(false);
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

    /**
     * Launch a system monitor command asynchronously.
     * Widgets call this instead of Process.execAsync directly.
     */
    launchMonitor(cmd: string): void {
        Process.execAsync(cmd).catch(e =>
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
     * Start sampling. `userTempPath` (from settings) takes priority over
     * auto-discovery. Idempotent — safe to call from every widget instance.
     */
    start(userTempPath?: string): void {
        if (this.#started) return;
        this.#started = true;

        this.#tempPath =
            (userTempPath &&
            Gio.File.new_for_path(userTempPath).query_exists(null)
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

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL, () => {
            this.#sample();
            return GLib.SOURCE_CONTINUE;
        });
    }

    #sample(): void {
        const cpuTop = new GTop.glibtop_cpu();
        glibtop_get_cpu(cpuTop);
        const total = cpuTop.total - this.#lastCpuTop.total;
        const user = cpuTop.user - this.#lastCpuTop.user;
        const sys = cpuTop.sys - this.#lastCpuTop.sys;
        const nice = cpuTop.nice - this.#lastCpuTop.nice;
        this.#lastCpuTop = cpuTop;
        this.#setCpu((user + sys + nice) / (total || 1));

        const memTop = new GTop.glibtop_mem();
        glibtop_get_mem(memTop);
        this.#setMemory(memTop.user / memTop.total);

        const diskTop = new GTop.glibtop_fsusage();
        glibtop_get_fsusage(diskTop, '/');
        this.#setDisk((diskTop.blocks - diskTop.bavail) / diskTop.blocks);

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
}
