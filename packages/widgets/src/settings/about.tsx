import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {Process} from '@shade/core/process';

function readOsInfo(): string {
    try {
        const content = GLib.file_get_contents('/etc/os-release')[1];
        const text = new TextDecoder().decode(content);
        const match = text.match(/^PRETTY_NAME="([^"]+)"/m);
        return match ? match[1] : 'Não disponível';
    } catch {
        return 'Não disponível';
    }
}

function readKernelVersion(): string {
    try {
        return Process.exec('uname -r').trim();
    } catch {
        return 'Não disponível';
    }
}

function readCpuInfo(): string {
    try {
        const content = GLib.file_get_contents('/proc/cpuinfo')[1];
        const text = new TextDecoder().decode(content);
        const match = text.match(/^model name\s*:\s*(.+)$/m);
        return match ? match[1].trim() : 'Não disponível';
    } catch {
        return 'Não disponível';
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
        return 'Não disponível';
    } catch {
        return 'Não disponível';
    }
}

function readGpuInfo(): string {
    try {
        const output = Process.exec('lspci | grep VGA');
        const match = output.match(/VGA compatible controller: (.+)$/m);
        return match ? match[1].trim() : 'Não disponível';
    } catch {
        return 'Não disponível';
    }
}

function readDiskInfo(): string {
    try {
        const output = Process.exec("df -h / | awk 'NR==2 {print $2\" total, \"$3\" used\"}'");
        return output.trim() || 'Não disponível';
    } catch {
        return 'Não disponível';
    }
}

export default () => {
    const os = readOsInfo();
    const hostname = GLib.get_host_name();
    const kernel = readKernelVersion();
    const cpu = readCpuInfo();
    const memory = readMemoryInfo();
    const gpu = readGpuInfo();
    const disk = readDiskInfo();

    const copyToClipboard = () => {
        const info = [
            `OS: ${os}`,
            `Hostname: ${hostname}`,
            `Kernel: ${kernel}`,
            `CPU: ${cpu}`,
            `Memory: ${memory}`,
            `GPU: ${gpu}`,
            `Disk: ${disk}`,
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
