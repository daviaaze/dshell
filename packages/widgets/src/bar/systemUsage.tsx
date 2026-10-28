import AstalBattery from 'gi://AstalBattery';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import SystemUsage, {
    HISTORY_LENGTH,
    type ProcessUsage,
    type StorageUsage,
} from '@shade/services/monitoring/systemUsage';
import BatteryHistory, {
    BATTERY_HISTORY_SLOTS,
    BATTERY_HISTORY_SPAN_S,
} from '@shade/services/power/batteryHistory';
import {barSettings} from '@shade/services/settings/bar.gschema';
import type {Accessor} from 'gnim';
import {bind, computed, For, onCleanup} from 'gnim';
import {usePopoverCleanup} from '../common/popoverCleanup';
import {UsageGraph} from '../common/usageGraph';

const LEVEL_BAR_SIZE = 50;
const COLUMN_WIDTH = 320;

const percent = (v: number) => `${Math.round(v * 100)}%`;
const usageText = ({used, total}: StorageUsage) =>
    total > 0 ? `${GLib.format_size(used)} / ${GLib.format_size(total)}` : '—';
const rateText = (bytesPerSecond: number) => `${GLib.format_size(Math.round(bytesPerSecond))}/s`;

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/** Section header: title on the left, live value on the right. */
function SectionHeader({title, value}: {title: string; value: Accessor<string>}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Label cssClasses={['heading']} label={title} hexpand halign={Gtk.Align.START} />
            <Gtk.Label cssClasses={['numeric']} label={value} halign={Gtk.Align.END} />
        </Gtk.Box>
    );
}

/** Labelled row with a level bar and a secondary detail line. */
function MeterRow({
    title,
    fraction,
    detail,
    visible = true,
}: {
    title: string;
    fraction: Accessor<number>;
    detail: Accessor<string>;
    visible?: Accessor<boolean> | boolean;
}) {
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={visible}>
            <Gtk.Box spacing={8}>
                <Gtk.Label label={title} hexpand halign={Gtk.Align.START} />
                <Gtk.Label cssClasses={['dimmed', 'numeric', 'caption']} label={detail} />
            </Gtk.Box>
            <Gtk.LevelBar value={fraction} />
        </Gtk.Box>
    );
}

function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function BatterySection() {
    const battery = AstalBattery.get_default();
    const history = BatteryHistory.get_default();
    const charging = bind(battery, 'charging');
    const percentage = bind(battery, 'percentage');
    const timeToFull = bind(battery, 'time-to-full');
    const timeToEmpty = bind(battery, 'time-to-empty');
    const energyRate = bind(battery, 'energy-rate');
    const health = bind(battery, 'capacity');
    const timeTo = computed(() => (charging() ? timeToFull() : timeToEmpty()));
    const status = computed(() => {
        const t = timeTo();
        if (percentage() >= 0.995 && !charging()) return 'Full';
        if (t <= 0) return charging() ? 'Charging' : 'Discharging';
        return `${fmtDuration(t)} ${charging() ? 'to full' : 'left'}`;
    });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            visible={bind(battery, 'is-present')}
        >
            <SectionHeader
                title="Battery"
                value={computed(() => `${percent(percentage())} · ${status()}`)}
            />
            <UsageGraph
                values={history.history}
                capacity={BATTERY_HISTORY_SLOTS}
                max={1}
                cssClasses={['success']}
            />
            <Gtk.Box spacing={8}>
                <Gtk.Label
                    cssClasses={['caption', 'dimmed']}
                    label={`Last ${BATTERY_HISTORY_SPAN_S / 3600} hours`}
                    hexpand
                    halign={Gtk.Align.START}
                />
                <Gtk.Label
                    cssClasses={['caption', 'numeric']}
                    label={computed(() => {
                        const parts = [];
                        if (energyRate() > 0) parts.push(`${energyRate().toFixed(1)} W`);
                        if (health() > 0) parts.push(`Health ${percent(health())}`);
                        return parts.join(' · ');
                    })}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
}

function ProcessesSection() {
    const usage = SystemUsage.get_default();
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <Gtk.Label cssClasses={['heading']} label="Top Processes" halign={Gtk.Align.START} />
            <Gtk.Label
                cssClasses={['caption', 'dimmed']}
                label="Measuring…"
                halign={Gtk.Align.START}
                visible={usage.topProcesses.as((p) => p.length === 0)}
            />
            <For each={usage.topProcesses} id={(p) => p.pid}>
                {(proc: ProcessUsage) => (
                    <Gtk.Box spacing={8}>
                        <Gtk.Label
                            label={proc.name}
                            tooltipText={`PID ${proc.pid}`}
                            hexpand
                            halign={Gtk.Align.START}
                            ellipsize={Pango.EllipsizeMode.END}
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'numeric', 'dimmed']}
                            label={GLib.format_size(proc.rss)}
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'numeric']}
                            label={`${(proc.cpu * 100).toFixed(1)}%`}
                            widthChars={6}
                            xalign={1}
                        />
                    </Gtk.Box>
                )}
            </For>
        </Gtk.Box>
    );
}

function SystemUsagePopover({onOpenMonitor}: {onOpenMonitor: () => void}) {
    const settings = barSettings();
    const usage = SystemUsage.get_default();
    const load = usage.loadAverage.as((l) => l.map((v) => v.toFixed(2)).join('  '));
    const swapFraction = usage.swapBytes.as(({used, total}) => (total > 0 ? used / total : 0));

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <Gtk.Box spacing={24} homogeneous>
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={12}
                    widthRequest={COLUMN_WIDTH}
                >
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="CPU" value={usage.cpu.as(percent)} />
                        <UsageGraph values={usage.cpuHistory} capacity={HISTORY_LENGTH} max={1} />
                        <Gtk.Box spacing={8}>
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label="Load average"
                                hexpand
                                halign={Gtk.Align.START}
                            />
                            <Gtk.Label cssClasses={['caption', 'numeric']} label={load} />
                        </Gtk.Box>
                        <Gtk.Box spacing={8} visible={usage.tempAvailable}>
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label="Temperature"
                                hexpand
                                halign={Gtk.Align.START}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                label={usage.temp.as((t) => `${Math.round(t * 100)} °C`)}
                            />
                        </Gtk.Box>
                    </Gtk.Box>

                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="Memory" value={usage.memoryBytes.as(usageText)} />
                        <UsageGraph
                            values={usage.memoryHistory}
                            capacity={HISTORY_LENGTH}
                            max={1}
                            cssClasses={['success']}
                        />
                    </Gtk.Box>

                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader
                            title="Network"
                            value={usage.net.as(
                                ({rx, tx}) => `↓ ${rateText(rx)}  ↑ ${rateText(tx)}`
                            )}
                        />
                        <UsageGraph
                            values={usage.netRxHistory}
                            secondary={usage.netTxHistory}
                            capacity={HISTORY_LENGTH}
                            cssClasses={['warning']}
                        />
                    </Gtk.Box>
                </Gtk.Box>

                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={12}
                    widthRequest={COLUMN_WIDTH}
                >
                    <BatterySection />
                    <ProcessesSection />
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <MeterRow
                            title="Swap"
                            fraction={swapFraction}
                            detail={usage.swapBytes.as(usageText)}
                            visible={usage.swapBytes.as(({total}) => total > 0)}
                        />
                        <MeterRow
                            title="Disk (/)"
                            fraction={usage.disk}
                            detail={usage.diskBytes.as(usageText)}
                        />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Box>

            <Gtk.Box spacing={8}>
                <Gtk.Label
                    cssClasses={['caption', 'dimmed']}
                    label={usage.uptime.as((s) => `Up ${formatUptime(s)}`)}
                    hexpand
                    halign={Gtk.Align.START}
                />
                <Gtk.Button
                    label="Open System Monitor"
                    visible={settings.systemMonitor.as((cmd) => cmd.trim().length > 0)}
                    onClicked={onOpenMonitor}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
}

const Indicator = ({
    value,
    label,
    unit,
    vertical,
    visible = true,
}: {
    value: Accessor<number>;
    label: string;
    unit: string;
    vertical: Accessor<boolean>;
    visible?: Accessor<boolean> | boolean;
}) => {
    const formattedValue = value.as((v) => (v * 100).toFixed(0).concat(unit));
    return (
        <Gtk.Box visible={visible} spacing={2} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box
                spacing={vertical.as((v) => (v ? 0 : 4))}
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Label
                    label={label}
                    tooltipText={label}
                    maxWidthChars={vertical.as((v) => (v ? 4 : -1))}
                    ellipsize={Pango.EllipsizeMode.END}
                    cssClasses={['caption-heading', 'numeric']}
                />
                <Gtk.Label
                    cssClasses={['caption', 'numeric']}
                    label={formattedValue}
                    tooltipText={formattedValue}
                    maxWidthChars={vertical.as((v) => (v ? 4 : -1))}
                    ellipsize={Pango.EllipsizeMode.END}
                />
            </Gtk.Box>
            <Gtk.LevelBar
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                inverted={vertical}
                value={value}
                widthRequest={vertical.as((v) => (v ? -1 : LEVEL_BAR_SIZE))}
                heightRequest={vertical.as((v) => (v ? LEVEL_BAR_SIZE : -1))}
            />
        </Gtk.Box>
    );
};

export default ({
    vertical,
    visible = true,
}: {
    vertical: Accessor<boolean>;
    visible?: boolean | Accessor<boolean>;
}) => {
    const settings = barSettings();
    const usage = SystemUsage.get_default();
    // Subscribe to polling; auto-unsubscribe on unmount so the service
    // stops waking the CPU when no system-usage widget is mounted.
    onCleanup(usage.subscribe());

    let popover: Gtk.Popover | null = null;
    const openMonitor = () => {
        popover?.popdown();
        const monitor = settings.systemMonitor();
        if (monitor) usage.launchMonitor(monitor);
    };

    return (
        <Gtk.MenuButton
            visible={visible}
            cssClasses={vertical.as((v) =>
                v ? ['flat', 'bar-vertical-content-button'] : ['flat']
            )}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            tooltipText={computed(
                () => `CPU ${percent(usage.cpu())} · RAM ${percent(usage.memory())}`
            )}
            ref={usePopoverCleanup}
        >
            <Gtk.Popover
                slot="popover"
                ref={(self) => {
                    popover = self;
                    // Process scans and UPower history only run while the popup is open.
                    let release: (() => void)[] = [];
                    const stop = () => {
                        for (const fn of release) fn();
                        release = [];
                    };
                    self.connect('show', () => {
                        stop();
                        release = [
                            usage.subscribeProcesses(),
                            BatteryHistory.get_default().subscribe(),
                        ];
                    });
                    self.connect('hide', stop);
                    onCleanup(stop);
                }}
            >
                <SystemUsagePopover onOpenMonitor={openMonitor} />
            </Gtk.Popover>
            <Gtk.Box
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={12}
            >
                <Indicator vertical={vertical} value={usage.cpu} label="CPU" unit="%" />
                <Indicator vertical={vertical} value={usage.memory} label="RAM" unit="%" />
                <Indicator
                    visible={usage.tempAvailable}
                    vertical={vertical}
                    value={usage.temp}
                    label="TEMP"
                    unit="°C"
                />
                <Indicator
                    vertical={vertical}
                    visible={settings.showDiskUsage}
                    value={usage.disk}
                    label="DISK"
                    unit="%"
                />
            </Gtk.Box>
        </Gtk.MenuButton>
    );
};
