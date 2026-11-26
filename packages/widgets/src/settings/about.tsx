import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {createState} from 'gnim';

const UNAVAILABLE = 'Não disponível';
const GPU_LINE = /^\S+\s+(?:VGA compatible|3D|Display) controller: (.+)$/gm;

function readOsInfo(): string {
    try {
        const content = GLib.file_get_contents('/etc/os-release')[1];
        const text = new TextDecoder().decode(content);
        const match = text.match(/^PRETTY_NAME="([^"]+)"/m);
        return match ? match[1] : UNAVAILABLE;
    } catch {
        return UNAVAILABLE;
    }
}

function readKernelVersion(): string {
    try {
        const content = GLib.file_get_contents('/proc/sys/kernel/osrelease')[1];
        return new TextDecoder().decode(content).trim() || UNAVAILABLE;
    } catch {
        return UNAVAILABLE;
    }
}

function readCpuInfo(): string {
    try {
        const content = GLib.file_get_contents('/proc/cpuinfo')[1];
        const text = new TextDecoder().decode(content);
        const match = text.match(/^model name\s*:\s*(.+)$/m);
        return match ? match[1].trim() : UNAVAILABLE;
    } catch {
        return UNAVAILABLE;
    }
}

function readMemoryInfo(): string {
    try {
        const content = GLib.file_get_contents('/proc/meminfo')[1];
        const text = new TextDecoder().decode(content);
        const match = text.match(/^MemTotal:\s+(\d+)\s+kB$/m);
        if (match) {
            const kb = parseInt(match[1], 10);
            const gb = (kb / 1024 / 1024).toFixed(1);
            return `${gb} GB`;
        }
        return UNAVAILABLE;
    } catch {
        return UNAVAILABLE;
    }
}

/** Display adapters from `lspci`, read without blocking the shell. */
async function readGpuInfo(): Promise<string> {
    try {
        const output = await Process.execAsync('lspci');
        const names = [...output.matchAll(GPU_LINE)].map((match) => match[1].trim());
        return names.length > 0 ? names.join('; ') : UNAVAILABLE;
    } catch (error) {
        logger.warn('settings-about', 'lspci failed:', error);
        return UNAVAILABLE;
    }
}

function readDiskInfo(): string {
    try {
        const info = Gio.File.new_for_path('/').query_filesystem_info(
            'filesystem::size,filesystem::used',
            null
        );
        const total = info.get_attribute_uint64('filesystem::size');
        const used = info.get_attribute_uint64('filesystem::used');
        if (total === 0) return UNAVAILABLE;
        return `${GLib.format_size(total)} no total, ${GLib.format_size(used)} em uso`;
    } catch {
        return UNAVAILABLE;
    }
}

export default () => {
    const os = readOsInfo();
    const hostname = GLib.get_host_name();
    const kernel = readKernelVersion();
    const cpu = readCpuInfo();
    const memory = readMemoryInfo();
    const disk = readDiskInfo();
    const [gpu, setGpu] = createState('Detectando…');
    void readGpuInfo().then(setGpu);

    const copyToClipboard = () => {
        const info = [
            `Sistema: ${os}`,
            `Nome do computador: ${hostname}`,
            `Kernel: ${kernel}`,
            `CPU: ${cpu}`,
            `Memória: ${memory}`,
            `Gráficos: ${gpu()}`,
            `Disco: ${disk}`,
        ].join('\n');

        const display = Gdk.Display.get_default();
        if (display) {
            const clipboard = display.get_clipboard();
            clipboard.set(info);
        }
    };

    return (
        <Adw.PreferencesGroup title="Sobre este sistema">
            <Adw.ActionRow title="Sistema operacional" subtitle={os} />
            <Adw.ActionRow title="Nome do computador" subtitle={hostname} />
            <Adw.ActionRow title="Kernel" subtitle={kernel} />
            <Adw.ActionRow title="Processador" subtitle={cpu} />
            <Adw.ActionRow title="Memória" subtitle={memory} />
            <Adw.ActionRow title="Gráficos" subtitle={gpu} />
            <Adw.ActionRow title="Disco" subtitle={disk} />

            <Gtk.Box marginTop={16} halign={Gtk.Align.CENTER}>
                <Gtk.Button
                    label="Copiar informações do sistema"
                    cssClasses={['suggested-action']}
                    onClicked={copyToClipboard}
                />
            </Gtk.Box>
        </Adw.PreferencesGroup>
    );
};
