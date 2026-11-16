import AstalBattery from 'gi://AstalBattery';
import {
    SURFACE_SPACING,
    getPopoverMaxHeight,
} from '../common/surface';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import SystemUsage, {
    HISTORY_LENGTH,
    type StorageUsage,
    type UsageOptions,
} from '@shade/services/monitoring/systemUsage';
import BatteryHistory, {
    BATTERY_HISTORY_SLOTS,
    BATTERY_HISTORY_SPAN_S,
} from '@shade/services/power/batteryHistory';
import {barSettings} from '@shade/services/settings/bar.gschema';
import type {Accessor} from 'gnim';
import {bind, computed, onCleanup, effect} from 'gnim';
import {usePopoverCleanup} from '../common/popoverCleanup';
import {UsageGraph} from '../common/usageGraph';
import {openSettings} from '../settings/settingsOpen';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const storageText = ({used, total}: StorageUsage) =>
    total > 0 ? `${GLib.format_size(used)} / ${GLib.format_size(total)}` : '—';
const rateText = (bytesPerSecond: number, bits: boolean) => {
    const amount = bits ? bytesPerSecond * 8 : bytesPerSecond;
    return `${GLib.format_size(Math.round(amount))}${bits ? 'b' : 'B'}/s`;
};
const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const fmtDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function SectionHeader({title, value}: {title: string | Accessor<string>; value: Accessor<string>}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Label cssClasses={['heading']} label={title} hexpand halign={Gtk.Align.START} />
            <Gtk.Label cssClasses={['numeric']} label={value} halign={Gtk.Align.END} />
        </Gtk.Box>
    );
}

function MeterRow({
    title,
    fraction,
    detail,
    visible = true,
}: {
    title: string | Accessor<string>;
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
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={bind(battery, 'is-present')}>
            <SectionHeader title="Battery" value={computed(() => `${percent(percentage())} · ${status()}`)} />
            <UsageGraph values={history.history} capacity={BATTERY_HISTORY_SLOTS} max={1} cssClasses={['success']} />
            <Gtk.Box spacing={8}>
                <Gtk.Label cssClasses={['caption', 'dimmed']} label={`Last ${BATTERY_HISTORY_SPAN_S / 3600} hours`} hexpand halign={Gtk.Align.START} />
                <Gtk.Label cssClasses={['caption', 'numeric']} label={computed(() => {
                    const parts = [];
                    if (energyRate() > 0) parts.push(`${energyRate().toFixed(1)} W`);
                    if (health() > 0) parts.push(`Health ${percent(health())}`);
                    return parts.join(' · ');
                })} />
            </Gtk.Box>
        </Gtk.Box>
    );
}

function ProcessesSection() {
    const usage = SystemUsage.get_default();
    const settings = barSettings();
    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={settings.systemUsageShowProcesses}>
            <Gtk.Box spacing={8}>
                <Gtk.Label cssClasses={['heading']} label="Top Processes" hexpand halign={Gtk.Align.START} />
                <Gtk.DropDown
                    model={Gtk.StringList.new(['CPU', 'Memory'])}
                    selected={settings.systemUsageProcessSort.as((sort) => sort === 'memory' ? 1 : 0)}
                    onNotifySelected={(self) => settings.setSystemUsageProcessSort(self.selected === 1 ? 'memory' : 'cpu')}
                />
                <Gtk.DropDown
                    model={Gtk.StringList.new(Array.from({length: 13}, (_, i) => String(i + 3)))}
                    selected={settings.systemUsageProcessCount.as((count) => count - 3)}
                    onNotifySelected={(self) => settings.setSystemUsageProcessCount(self.selected + 3)}
                />
            </Gtk.Box>
            <Gtk.Label cssClasses={['caption', 'dimmed']} label="Measuring…" halign={Gtk.Align.START} visible={usage.topProcesses.as((p) => p.length === 0)} />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} ref={(box) => {
                const rows = new Map<number, {row: Gtk.Box; name: Gtk.Label; rss: Gtk.Label; cpu: Gtk.Label}>();
                const update = () => {
                    const items = usage.topProcesses();
                    const currentPids = new Set<number>();
                    for (const item of items) {
                        currentPids.add(item.pid);
                        let widgets = rows.get(item.pid);
                        if (!widgets) {
                            const name = new Gtk.Label({
                                visible: true,
                                hexpand: true,
                                halign: Gtk.Align.START,
                                ellipsize: Pango.EllipsizeMode.END,
                            });
                            const rss = new Gtk.Label({visible: true, cssClasses: ['caption', 'numeric', 'dimmed']});
                            const cpu = new Gtk.Label({visible: true, cssClasses: ['caption', 'numeric'], widthChars: 6, xalign: 1});
                            const row = new Gtk.Box({visible: true, spacing: 8});
                            row.append(name);
                            row.append(rss);
                            row.append(cpu);
                            box.append(row);
                            widgets = {row, name, rss, cpu};
                            rows.set(item.pid, widgets);
                        }
                        widgets.name.set_label(item.name);
                        widgets.name.set_tooltip_text(`PID ${item.pid}`);
                        widgets.rss.set_label(GLib.format_size(item.rss));
                        widgets.cpu.set_label(`${(item.cpu * 100).toFixed(1)}%`);
                    }
                    for (const [pid, widgets] of rows) {
                        if (currentPids.has(pid)) continue;
                        if (widgets.row.get_parent() === box) box.remove(widgets.row);
                        rows.delete(pid);
                    }
                    let previous: Gtk.Widget | null = null;
                    for (const item of items) {
                        const row = rows.get(item.pid)?.row;
                        if (!row) continue;
                        box.reorder_child_after(row, previous);
                        previous = row;
                    }
                };
                let unsubscribe: (() => void) | null = null;
                const onMap = () => {
                    if (!unsubscribe) unsubscribe = usage.topProcesses.subscribe(update);
                    update();
                };
                const onUnmap = () => {
                    unsubscribe?.();
                    unsubscribe = null;
                };
                const mapSignal = box.connect('map', onMap);
                const unmapSignal = box.connect('unmap', onUnmap);
                if (box.get_mapped()) onMap();
                onCleanup(() => {
                    box.disconnect(mapSignal);
                    box.disconnect(unmapSignal);
                    onUnmap();
                    for (const {row} of rows.values()) {
                        if (row.get_parent() === box) box.remove(row);
                    }
                    rows.clear();
                });
            }} />
        </Gtk.Box>
    );
}
 

function SystemUsagePopover({onOpenMonitor}: {onOpenMonitor: () => void}) {
    const settings = barSettings();
    const usage = SystemUsage.get_default();
    const bits = settings.networkRateUnit.as((unit) => unit === 'bits');
    const load = usage.loadAverage.as((l) => l.map((v) => v.toFixed(2)).join('  '));
    const swapFraction = usage.swapBytes.as(({used, total}) => (total > 0 ? used / total : 0));
    const memoryDetails = usage.memoryDetails;
    const diskTitle = settings.systemUsageDiskPath.as((path) => `Disk (${path || '/'})`);
    const diskDetails = computed(() => {
        if (!usage.diskAvailable()) return 'Unavailable';
        const {used, total} = usage.diskBytes();
        return total > 0
            ? `${GLib.format_size(used)} used · ${GLib.format_size(total - used)} free`
            : 'Unavailable';
    });
    const intervalLabel = settings.systemUsageInterval.as((ms) => `~${Math.round(ms * HISTORY_LENGTH / 1000)}s history`);
    const showGraphs = settings.systemUsageShowGraphs;
    const showCores = settings.systemUsageShowPerCore;
    return (
        <Gtk.ScrolledWindow maxContentHeight={600} propagateNaturalHeight hscrollbarPolicy={Gtk.PolicyType.NEVER} ref={(self) => {
            self.connect('map', () => { self.maxContentHeight = getPopoverMaxHeight(self); });
        }}>
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={SURFACE_SPACING}>
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={SURFACE_SPACING}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <SectionHeader title="CPU" value={usage.cpu.as(percent)} />
                        <Gtk.Label cssClasses={['caption', 'dimmed']} label={computed(() => {
                            const model = usage.cpuModel();
                            const freq = usage.cpuFrequencyMHz();
                            return `${model || 'Processor'}${freq ? ` · ${(freq / 1000).toFixed(2)} GHz` : ''}`;
                        })} halign={Gtk.Align.START} wrap />
                        <Gtk.Box visible={showGraphs}><UsageGraph values={usage.cpuHistory} capacity={HISTORY_LENGTH} max={1} /></Gtk.Box>
                        <Gtk.Box spacing={8}><Gtk.Label cssClasses={['caption', 'dimmed']} label="Load average" hexpand halign={Gtk.Align.START} /><Gtk.Label cssClasses={['caption', 'numeric']} label={load} /></Gtk.Box>
                        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} visible={computed(() => showCores() && usage.cpuCores().length > 1)}>
                            <Gtk.Label cssClasses={['caption', 'dimmed']} label="Per-core usage" halign={Gtk.Align.START} />
                            <Gtk.FlowBox selectionMode={Gtk.SelectionMode.NONE} homogeneous minChildrenPerLine={2} maxChildrenPerLine={8} rowSpacing={4} columnSpacing={8} ref={(flow) => {
                                const rows = new Map<number, {child: Gtk.FlowBoxChild; usage: Gtk.LevelBar}>();
                                const update = () => {
                                    const cores = usage.cpuCores();
                                    const currentIds = new Set<number>();
                                    for (const core of cores) {
                                        currentIds.add(core.id);
                                        let widgets = rows.get(core.id);
                                        if (!widgets) {
                                            const child = new Gtk.FlowBoxChild({visible: true});
                                            const row = new Gtk.Box({visible: true, spacing: 4});
                                            const label = new Gtk.Label({visible: true, cssClasses: ['caption', 'numeric']});
                                            const level = new Gtk.LevelBar({visible: true, hexpand: true});
                                            row.append(label);
                                            row.append(level);
                                            child.set_child(row);
                                            flow.insert(child, -1);
                                            widgets = {child, usage: level};
                                            rows.set(core.id, widgets);
                                        }
                                        const label = widgets.child.get_child()?.get_first_child();
                                        if (label instanceof Gtk.Label) label.set_label(`CPU ${core.id}`);
                                        widgets.usage.set_value(core.usage);
                                    }
                                    for (const [id, widgets] of rows) {
                                        if (currentIds.has(id)) continue;
                                        if (widgets.child.get_parent() === flow) flow.remove(widgets.child);
                                        rows.delete(id);
                                    }
                                    cores.forEach((core, position) => {
                                        const child = rows.get(core.id)?.child;
                                        if (child && child.get_index() !== position) {
                                            flow.remove(child);
                                            flow.insert(child, position);
                                        }
                                    });
                                };
                                let unsubscribe: (() => void) | null = null;
                                const onMap = () => {
                                    if (!unsubscribe) unsubscribe = usage.cpuCores.subscribe(update);
                                    update();
                                };
                                const onUnmap = () => {
                                    unsubscribe?.();
                                    unsubscribe = null;
                                };
                                const mapSignal = flow.connect('map', onMap);
                                const unmapSignal = flow.connect('unmap', onUnmap);
                                if (flow.get_mapped()) onMap();
                                onCleanup(() => {
                                    flow.disconnect(mapSignal);
                                    flow.disconnect(unmapSignal);
                                    onUnmap();
                                    for (const {child} of rows.values()) {
                                        if (child.get_parent() === flow) flow.remove(child);
                                    }
                                    rows.clear();
                                });
                            }} />
                        </Gtk.Box>
                        <Gtk.Box spacing={8} visible={usage.tempAvailable}>
                            <Gtk.Label cssClasses={['caption', 'dimmed']} label="Temperature" hexpand halign={Gtk.Align.START} />
                            <Gtk.Label cssClasses={['caption', 'numeric']} label={usage.temp.as((t) => `${Math.round(t * 100)} °C`)} />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="Memory" value={usage.memoryBytes.as(storageText)} />
                        <Gtk.Box visible={showGraphs}><UsageGraph values={usage.memoryHistory} capacity={HISTORY_LENGTH} max={1} cssClasses={['success']} /></Gtk.Box>
                        <Gtk.Box spacing={8} visible={memoryDetails.as((d) => d !== null)}>
                            <Gtk.Label cssClasses={['caption', 'dimmed']} label="Available" hexpand halign={Gtk.Align.START} />
                            <Gtk.Label cssClasses={['caption', 'numeric']} label={memoryDetails.as((d) => GLib.format_size(d?.available ?? 0))} />
                        </Gtk.Box>
                        <Gtk.Box spacing={8} visible={memoryDetails.as((d) => d !== null)}>
                            <Gtk.Label cssClasses={['caption', 'dimmed']} label="Free · cache" hexpand halign={Gtk.Align.START} />
                            <Gtk.Label cssClasses={['caption', 'numeric']} label={memoryDetails.as((d) => `${GLib.format_size(d?.free ?? 0)} · ${GLib.format_size(d?.cached ?? 0)}`)} />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader
                            title={settings.systemUsageNetworkInterface.as((name) => `Network${name ? ` (${name})` : ' (all)'}`)}
                            value={computed(() => usage.netAvailable()
                                ? `↓ ${rateText(usage.net().rx, bits())}  ↑ ${rateText(usage.net().tx, bits())}`
                                : 'Unavailable')}
                        />
                        <Gtk.Box visible={computed(() => usage.netAvailable() && showGraphs())}>
                            <UsageGraph values={usage.netRxHistory} secondary={usage.netTxHistory} capacity={HISTORY_LENGTH} cssClasses={['warning']} />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="Storage" value={diskDetails} />
                        <MeterRow title={diskTitle} fraction={usage.disk} detail={diskDetails} visible={usage.diskAvailable} />
                        <MeterRow title="Swap" fraction={swapFraction} detail={usage.swapBytes.as(storageText)} visible={usage.swapBytes.as(({total}) => total > 0)} />
                    </Gtk.Box>
                </Gtk.Box>
                <BatterySection />
                <ProcessesSection />
                <Gtk.Box spacing={8}>
                    <Gtk.Label cssClasses={['caption', 'dimmed']} label={usage.uptime.as((s) => `Up ${formatUptime(s)} · ${intervalLabel()}`)} hexpand halign={Gtk.Align.START} />
                    <Gtk.Button label="Personalizar" onClicked={() => openSettings('bar')} />
                    <Gtk.Button label="Open System Monitor" visible={settings.systemMonitor.as((cmd) => cmd.trim().length > 0)} onClicked={onOpenMonitor} />
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
}

const Indicator = ({value, label, unit, vertical, visible = true, style}: {
    value: Accessor<number>; label: string; unit: string; vertical: Accessor<boolean>;
    visible?: Accessor<boolean> | boolean; style: Accessor<string>;
}) => {
    const formatted = value.as((v) => `${(v * 100).toFixed(0)}${unit}`);
    return (
        <Gtk.Box visible={visible} spacing={2} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box spacing={vertical.as((v) => (v ? 0 : 4))} orientation={vertical.as((v) => v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)}>
                <Gtk.Label visible={style.as((s) => s !== 'compact')} label={label} tooltipText={label} maxWidthChars={vertical.as((v) => v ? 4 : -1)} ellipsize={Pango.EllipsizeMode.END} cssClasses={['caption-heading', 'numeric']} />
                <Gtk.Label cssClasses={['caption', 'numeric']} label={formatted} tooltipText={formatted} maxWidthChars={vertical.as((v) => v ? 4 : -1)} ellipsize={Pango.EllipsizeMode.END} />
            </Gtk.Box>
            <Gtk.LevelBar visible={style.as((s) => s === 'bars')} orientation={vertical.as((v) => v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} inverted={vertical} value={value} widthRequest={vertical.as((v) => v ? -1 : 50)} heightRequest={vertical.as((v) => v ? 50 : -1)} />
        </Gtk.Box>
    );
};

export default ({vertical, visible = true}: {vertical: Accessor<boolean>; visible?: boolean | Accessor<boolean>}) => {
    const settings = barSettings();
    const usage = SystemUsage.get_default();
    effect(() => {
        const options: UsageOptions = {
            intervalMs: settings.systemUsageInterval(),
            networkInterface: settings.systemUsageNetworkInterface(),
            diskPath: settings.systemUsageDiskPath(),
            processSort: settings.systemUsageProcessSort() as 'cpu' | 'memory',
            processCount: settings.systemUsageProcessCount(),
            tempPath: settings.tempPath(),
        };
        usage.configure(options);
    });
    onCleanup(usage.subscribe());

    let popover: Gtk.Popover | null = null;
    let anchor: Gtk.MenuButton | null = null;
    const openMonitor = () => {
        popover?.popdown();
        const monitor = settings.systemMonitor();
        if (monitor) usage.launchMonitor(monitor);
    };
    const cpuOn = settings.showCpuUsage;
    const memoryOn = settings.showMemoryUsage;
    const tempOn = computed(() => settings.showTemperature() && usage.tempAvailable());
    const diskOn = computed(() => settings.showDiskUsage() && usage.diskAvailable());
    const networkOn = computed(() => settings.showNetworkUsage() && usage.netAvailable());
    const swapOn = computed(() => settings.showSwapUsage() && usage.swapBytes().total > 0);
    const anyMetric = computed(() => cpuOn() || memoryOn() || tempOn() || diskOn() || networkOn() || swapOn());
    const style = settings.resourceIndicatorStyle;
    const bits = settings.networkRateUnit.as((v) => v === 'bits');
    let popoverShown = false;
    let releaseProcesses: (() => void) | null = null;
    const syncProcessSubscription = () => {
        if (!popoverShown || !settings.systemUsageShowProcesses()) {
            releaseProcesses?.();
            releaseProcesses = null;
        } else if (!releaseProcesses) {
            releaseProcesses = usage.subscribeProcesses();
        }
    };
    effect(() => {
        settings.systemUsageShowProcesses();
        syncProcessSubscription();
    });
    return (
        <Gtk.MenuButton
            visible={visible}
            cssClasses={vertical.as((v) => v ? ['flat', 'bar-vertical-content-button'] : ['flat'])}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            tooltipText={computed(() => `CPU ${percent(usage.cpu())} · RAM ${percent(usage.memory())}`)}
            ref={usePopoverCleanup}
        >
            <Gtk.Popover slot="popover" ref={(self) => {
                popover = self;
                let releaseBattery: (() => void) | null = null;
                const stop = () => {
                    popoverShown = false;
                    releaseProcesses?.();
                    releaseProcesses = null;
                    releaseBattery?.();
                    releaseBattery = null;
                };
                self.connect('show', () => {
                    popoverShown = true;
                    syncProcessSubscription();
                    releaseBattery = BatteryHistory.get_default().subscribe();
                });
                self.connect('hide', stop);
                onCleanup(stop);
            }}>
                <SystemUsagePopover onOpenMonitor={openMonitor} />
            </Gtk.Popover>
            <Gtk.Box orientation={vertical.as((v) => v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)}>
                <Gtk.Box visible={anyMetric.as((has) => !has)}><Gtk.Image iconName="computer-symbolic" /></Gtk.Box>
                <Gtk.Box visible={anyMetric} orientation={vertical.as((v) => v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)} spacing={12}>
                <Indicator visible={cpuOn} vertical={vertical} value={usage.cpu} label="CPU" unit="%" style={style} />
                <Indicator visible={memoryOn} vertical={vertical} value={usage.memory} label="RAM" unit="%" style={style} />
                <Indicator visible={tempOn} vertical={vertical} value={usage.temp} label="TEMP" unit="°C" style={style} />
                <Indicator visible={diskOn} vertical={vertical} value={usage.disk} label="DISK" unit="%" style={style} />
                <Indicator visible={swapOn} vertical={vertical} value={usage.swapBytes.as(({used, total}) => total ? used / total : 0)} label="SWAP" unit="%" style={style} />
                <Gtk.Box visible={networkOn} orientation={vertical.as((v) => v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)} spacing={2}>
                    <Gtk.Label visible={style.as((s) => s !== 'compact')} cssClasses={['caption-heading', 'numeric']} label="NET" />
                    <Gtk.Label cssClasses={['caption', 'numeric']} label={usage.net.as(({rx, tx}) => `↓${rateText(rx, bits())} ↑${rateText(tx, bits())}`)} />
                </Gtk.Box>
            </Gtk.Box>
            </Gtk.Box>
        </Gtk.MenuButton>
    );
};
