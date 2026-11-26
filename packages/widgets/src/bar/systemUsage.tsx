import AstalBattery from 'gi://AstalBattery';
import {SURFACE_SPACING, getPopoverMaxHeight} from '../common/surface';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import SystemUsage, {
    HISTORY_LENGTH,
    type CpuCoreUsage,
    type StorageUsage,
    type UsageOptions,
} from '@shade/services/monitoring/systemUsage';
import RemoteSystemUsage from '@shade/services/monitoring/remoteSystemUsage';
import BatteryHistory, {
    BATTERY_HISTORY_SLOTS,
    BATTERY_HISTORY_SPAN_S,
} from '@shade/services/power/batteryHistory';
import {barSettings} from '@shade/services/settings/bar.gschema';
import type {Accessor} from 'gnim';
import {bind, computed, onCleanup, effect, untrack} from 'gnim';
import {usePopoverCleanup} from '../common/popoverCleanup';
import {setAccessibleName} from '../common/iconButton';
import {UsageGraph} from '../common/usageGraph';
import {openSettings} from '../settings/settingsOpen';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const storageText = ({used, total}: StorageUsage) =>
    total > 0 ? `${GLib.format_size(used)} / ${GLib.format_size(total)}` : '—';
const rateText = (bytesPerSecond: number, bits: boolean) => {
    const amount = bits ? bytesPerSecond * 8 : bytesPerSecond;
    return `${GLib.format_size_full(Math.round(amount), bits ? GLib.FormatSizeFlags.BITS : GLib.FormatSizeFlags.DEFAULT)}/s`;
};
const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};
const fmtDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function SectionHeader({
    title,
    value,
}: {
    title: string | Accessor<string>;
    value: Accessor<string>;
}) {
    return (
        <Gtk.Box spacing={8}>
            <Gtk.Label
                cssClasses={['heading']}
                label={title}
                tooltipText={title}
                hexpand
                xalign={0}
                ellipsize={Pango.EllipsizeMode.END}
                maxWidthChars={20}
            />
            <Gtk.Label
                cssClasses={['numeric']}
                label={value}
                tooltipText={value}
                xalign={1}
                ellipsize={Pango.EllipsizeMode.END}
                maxWidthChars={30}
            />
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
                <Gtk.Label
                    label={title}
                    tooltipText={title}
                    hexpand
                    xalign={0}
                    ellipsize={Pango.EllipsizeMode.END}
                    maxWidthChars={20}
                />
                <Gtk.Label
                    cssClasses={['dimmed', 'numeric', 'caption']}
                    label={detail}
                    tooltipText={detail}
                    ellipsize={Pango.EllipsizeMode.END}
                    maxWidthChars={30}
                    xalign={1}
                />
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
        if (percentage() >= 0.995 && !charging()) return 'Carregada';
        if (t <= 0) return charging() ? 'Carregando' : 'Descarregando';
        return `${fmtDuration(t)} ${charging() ? 'para carregar' : 'restantes'}`;
    });
    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            visible={bind(battery, 'is-present')}
        >
            <SectionHeader
                title="Bateria"
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
                    label={`Últimas ${BATTERY_HISTORY_SPAN_S / 3600} horas`}
                    hexpand
                    halign={Gtk.Align.START}
                />
                <Gtk.Label
                    cssClasses={['caption', 'numeric']}
                    label={computed(() => {
                        const parts = [];
                        if (energyRate() > 0) parts.push(`${energyRate().toFixed(1)} W`);
                        if (health() > 0) parts.push(`Saúde ${percent(health())}`);
                        return parts.join(' · ');
                    })}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
}

function ProcessesSection() {
    const usage = SystemUsage.get_default();
    const settings = barSettings();
    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            visible={settings.systemUsageShowProcesses}
        >
            <Gtk.Box spacing={8}>
                <Gtk.Label
                    cssClasses={['heading']}
                    label="Principais processos"
                    hexpand
                    halign={Gtk.Align.START}
                />
                <Gtk.DropDown
                    model={Gtk.StringList.new(['CPU', 'Memória'])}
                    tooltipText="Ordenar processos por"
                    ref={setAccessibleName('Ordenar processos por')}
                    selected={settings.systemUsageProcessSort.as((sort) =>
                        sort === 'memory' ? 1 : 0
                    )}
                    onNotifySelected={(self) =>
                        settings.setSystemUsageProcessSort(self.selected === 1 ? 'memory' : 'cpu')
                    }
                />
                <Gtk.DropDown
                    model={Gtk.StringList.new(Array.from({length: 13}, (_, i) => String(i + 3)))}
                    tooltipText="Quantidade de processos"
                    ref={setAccessibleName('Quantidade de processos')}
                    selected={settings.systemUsageProcessCount.as((count) => count - 3)}
                    onNotifySelected={(self) =>
                        settings.setSystemUsageProcessCount(self.selected + 3)
                    }
                />
            </Gtk.Box>
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                ref={(box) => {
                    const rows = Array.from({length: 15}, () => {
                        const name = new Gtk.Label({
                            visible: true,
                            hexpand: true,
                            xalign: 0,
                            widthChars: 12,
                            maxWidthChars: 24,
                            ellipsize: Pango.EllipsizeMode.END,
                        });
                        const rss = new Gtk.Label({
                            visible: true,
                            cssClasses: ['caption', 'numeric', 'dimmed'],
                            widthChars: 9,
                            maxWidthChars: 9,
                            xalign: 1,
                            ellipsize: Pango.EllipsizeMode.END,
                        });
                        const cpu = new Gtk.Label({
                            visible: true,
                            cssClasses: ['caption', 'numeric'],
                            widthChars: 6,
                            maxWidthChars: 6,
                            xalign: 1,
                        });
                        const row = new Gtk.Box({visible: false, spacing: 8, heightRequest: 22});
                        row.append(name);
                        row.append(rss);
                        row.append(cpu);
                        box.append(row);
                        return {row, name, rss, cpu};
                    });
                    const update = () => {
                        const items = usage.topProcesses();
                        const count = settings.systemUsageProcessCount();
                        rows.forEach((widgets, index) => {
                            const item = index < count ? items[index] : undefined;
                            widgets.row.visible = index < count;
                            widgets.name.set_label(item?.name ?? '—');
                            widgets.name.set_tooltip_text(item ? `PID ${item.pid}` : null);
                            widgets.rss.set_label(item ? GLib.format_size(item.rss) : '');
                            widgets.cpu.set_label(item ? `${(item.cpu * 100).toFixed(1)}%` : '');
                        });
                    };
                    let unsubscribe: (() => void) | null = null;
                    const onMap = () => {
                        if (!unsubscribe) {
                            const stopMetrics = usage.topProcesses.subscribe(update);
                            const stopCount = settings.systemUsageProcessCount.subscribe(update);
                            unsubscribe = () => {
                                stopMetrics();
                                stopCount();
                            };
                        }
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
                    });
                }}
            />
        </Gtk.Box>
    );
}

type CommonMetric = Pick<
    SystemUsage,
    | 'cpu'
    | 'memory'
    | 'disk'
    | 'temp'
    | 'tempAvailable'
    | 'cpuHistory'
    | 'memoryHistory'
    | 'netRxHistory'
    | 'netTxHistory'
    | 'net'
    | 'memoryBytes'
    | 'swapBytes'
    | 'diskBytes'
    | 'loadAverage'
    | 'uptime'
    | 'cpuCores'
    | 'cpuModel'
    | 'cpuFrequencyMHz'
    | 'memoryDetails'
    | 'networkInterfaces'
    | 'netAvailable'
    | 'diskAvailable'
>;

function projectMetrics(
    local: CommonMetric,
    remoteMetrics: CommonMetric,
    isRemote: Accessor<boolean>
): CommonMetric {
    const select = <T,>(localAccessor: Accessor<T>, remoteAccessor: Accessor<T>) =>
        computed(() => (isRemote() ? remoteAccessor() : localAccessor()));
    return {
        cpu: select(local.cpu, remoteMetrics.cpu),
        memory: select(local.memory, remoteMetrics.memory),
        disk: select(local.disk, remoteMetrics.disk),
        temp: select(local.temp, remoteMetrics.temp),
        tempAvailable: select(local.tempAvailable, remoteMetrics.tempAvailable),
        cpuHistory: select(local.cpuHistory, remoteMetrics.cpuHistory),
        memoryHistory: select(local.memoryHistory, remoteMetrics.memoryHistory),
        netRxHistory: select(local.netRxHistory, remoteMetrics.netRxHistory),
        netTxHistory: select(local.netTxHistory, remoteMetrics.netTxHistory),
        net: select(local.net, remoteMetrics.net),
        memoryBytes: select(local.memoryBytes, remoteMetrics.memoryBytes),
        swapBytes: select(local.swapBytes, remoteMetrics.swapBytes),
        diskBytes: select(local.diskBytes, remoteMetrics.diskBytes),
        loadAverage: select(local.loadAverage, remoteMetrics.loadAverage),
        uptime: select(local.uptime, remoteMetrics.uptime),
        cpuCores: select(local.cpuCores, remoteMetrics.cpuCores),
        cpuModel: select(local.cpuModel, remoteMetrics.cpuModel),
        cpuFrequencyMHz: select(local.cpuFrequencyMHz, remoteMetrics.cpuFrequencyMHz),
        memoryDetails: select(local.memoryDetails, remoteMetrics.memoryDetails),
        networkInterfaces: select(local.networkInterfaces, remoteMetrics.networkInterfaces),
        netAvailable: select(local.netAvailable, remoteMetrics.netAvailable),
        diskAvailable: select(local.diskAvailable, remoteMetrics.diskAvailable),
    };
}

function CpuCores({cores}: {cores: Accessor<CpuCoreUsage[]>}) {
    return (
        <Gtk.Grid
            columnHomogeneous
            columnSpacing={12}
            rowSpacing={8}
            hexpand
            ref={(grid) => {
                const cells = new Map<
                    number,
                    {content: Gtk.Box; name: Gtk.Label; value: Gtk.Label; meter: Gtk.LevelBar}
                >();
                const update = () => {
                    const items = cores();
                    const ids = new Set(items.map((core) => core.id));
                    for (const [id, cell] of cells) {
                        if (ids.has(id)) continue;
                        grid.remove(cell.content);
                        cells.delete(id);
                    }
                    items.forEach((core, index) => {
                        let cell = cells.get(core.id);
                        if (!cell) {
                            const name = new Gtk.Label({
                                visible: true,
                                cssClasses: ['caption', 'numeric'],
                                hexpand: true,
                                xalign: 0,
                            });
                            const value = new Gtk.Label({
                                visible: true,
                                cssClasses: ['caption', 'numeric'],
                                widthChars: 4,
                                maxWidthChars: 4,
                                xalign: 1,
                            });
                            const meter = new Gtk.LevelBar({
                                visible: true,
                                hexpand: true,
                                mode: Gtk.LevelBarMode.CONTINUOUS,
                            });
                            const top = new Gtk.Box({visible: true, spacing: 4});
                            top.append(name);
                            top.append(value);
                            const content = new Gtk.Box({
                                visible: true,
                                orientation: Gtk.Orientation.VERTICAL,
                                spacing: 3,
                                hexpand: true,
                            });
                            content.append(top);
                            content.append(meter);
                            grid.attach(content, index % 4, Math.floor(index / 4), 1, 1);
                            cell = {content, name, value, meter};
                            cells.set(core.id, cell);
                        }
                        const [column, row] = grid.query_child(cell.content);
                        if (column !== index % 4 || row !== Math.floor(index / 4)) {
                            grid.remove(cell.content);
                            grid.attach(cell.content, index % 4, Math.floor(index / 4), 1, 1);
                        }
                        cell.name.set_label(`CPU ${core.id}`);
                        cell.value.set_label(percent(core.usage));
                        cell.meter.set_value(core.usage);
                        cell.content.set_tooltip_text(`CPU ${core.id}: ${percent(core.usage)}`);
                    });
                };
                let unsubscribe: (() => void) | null = null;
                const onMap = () => {
                    unsubscribe ??= cores.subscribe(update);
                    update();
                };
                const onUnmap = () => {
                    unsubscribe?.();
                    unsubscribe = null;
                };
                const mapSignal = grid.connect('map', onMap);
                const unmapSignal = grid.connect('unmap', onUnmap);
                if (grid.get_mapped()) onMap();
                onCleanup(() => {
                    grid.disconnect(mapSignal);
                    grid.disconnect(unmapSignal);
                    onUnmap();
                    cells.clear();
                });
            }}
        />
    );
}

function SystemUsagePopover({
    onOpenMonitor,
    usage,
    isRemote,
}: {
    onOpenMonitor: () => void;
    usage: CommonMetric;
    isRemote: Accessor<boolean>;
}) {
    const settings = barSettings();
    const remote = RemoteSystemUsage.get_default();
    const bits = settings.networkRateUnit.as((unit) => unit === 'bits');
    const available = computed(() => !isRemote() || remote.hasSample());
    const ratesReady = computed(() => !isRemote() || remote.ratesReady());
    const status = computed(() => {
        if (!isRemote()) return 'Este computador';
        if (remote.state() === 'error')
            return remote.hasSample()
                ? 'Homelab indisponível · dados desatualizados'
                : 'Homelab indisponível';
        if (!remote.hasSample()) return 'Conectando ao homelab…';
        return `Homelab · ${remote.hostname() || 'Servidor remoto'}`;
    });
    const diskTitle = computed(
        () =>
            `Disco (${(isRemote() ? settings.systemUsageRemoteDiskPath() : settings.systemUsageDiskPath()) || '/'})`
    );
    const diskDetails = computed(() => {
        if (!usage.diskAvailable()) return 'Indisponível';
        const {used, total} = usage.diskBytes();
        return `${GLib.format_size(used)} em uso · ${GLib.format_size(Math.max(0, total - used))} livres`;
    });
    const intervalLabel = computed(
        () =>
            `histórico de ~${Math.round(((isRemote() ? settings.systemUsageRemoteInterval() : settings.systemUsageInterval()) * HISTORY_LENGTH) / 1000)}s`
    );
    const showGraphs = settings.systemUsageShowGraphs;
    const memoryDetails = usage.memoryDetails;
    return (
        <Gtk.ScrolledWindow
            widthRequest={440}
            heightRequest={600}
            minContentWidth={440}
            maxContentWidth={440}
            minContentHeight={600}
            maxContentHeight={600}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            ref={(self) => {
                const signal = self.connect('map', () => {
                    const surface = self.get_native()?.get_surface();
                    const monitor = surface
                        ? self.get_display().get_monitor_at_surface(surface)
                        : null;
                    const width = Math.min(
                        440,
                        Math.max(1, (monitor?.get_geometry().width ?? 488) - 48)
                    );
                    const height = Math.min(600, getPopoverMaxHeight(self));
                    self.widthRequest = width;
                    self.heightRequest = height;
                    self.minContentWidth = width;
                    self.maxContentWidth = width;
                    self.minContentHeight = height;
                    self.maxContentHeight = height;
                });
                onCleanup(() => self.disconnect(signal));
            }}
        >
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={SURFACE_SPACING}
                marginTop={12}
                marginBottom={12}
                marginStart={12}
                marginEnd={12}
            >
                <Gtk.Box spacing={8}>
                    <Gtk.DropDown
                        model={Gtk.StringList.new(['Local', 'Homelab'])}
                        tooltipText="Fonte das métricas"
                        ref={setAccessibleName('Fonte das métricas')}
                        selected={settings.systemUsageSource.as((value) =>
                            value === 'homelab' ? 1 : 0
                        )}
                        onNotifySelected={(self) =>
                            settings.setSystemUsageSource(self.selected === 1 ? 'homelab' : 'local')
                        }
                    />
                    <Gtk.Label
                        label={status}
                        tooltipText={computed(() =>
                            isRemote() && remote.error() ? remote.error() : status()
                        )}
                        hexpand
                        xalign={0}
                        ellipsize={Pango.EllipsizeMode.END}
                        maxWidthChars={36}
                        cssClasses={['caption', 'dimmed']}
                    />
                </Gtk.Box>
                <Gtk.Box visible={available} orientation={Gtk.Orientation.VERTICAL} spacing={12}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                        <SectionHeader
                            title="CPU"
                            value={computed(() => (ratesReady() ? percent(usage.cpu()) : '—'))}
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'dimmed']}
                            label={computed(() => {
                                const model = usage.cpuModel();
                                const freq = usage.cpuFrequencyMHz();
                                return `${model || (isRemote() ? 'Processador remoto' : 'Processador')}${freq ? ` · ${(freq / 1000).toFixed(2)} GHz` : ''}`;
                            })}
                            xalign={0}
                            ellipsize={Pango.EllipsizeMode.END}
                            maxWidthChars={50}
                        />
                        <Gtk.Box visible={showGraphs}>
                            <UsageGraph
                                values={usage.cpuHistory}
                                capacity={HISTORY_LENGTH}
                                max={1}
                            />
                        </Gtk.Box>
                        <SectionHeader
                            title="Carga média"
                            value={usage.loadAverage.as((load) =>
                                load.map((value) => value.toFixed(2)).join('  ')
                            )}
                        />
                        <Gtk.Box
                            orientation={Gtk.Orientation.VERTICAL}
                            spacing={6}
                            visible={computed(
                                () =>
                                    settings.systemUsageShowPerCore() && usage.cpuCores().length > 1
                            )}
                        >
                            <Gtk.Label
                                label="Uso por thread"
                                xalign={0}
                                cssClasses={['caption', 'dimmed']}
                            />
                            <CpuCores cores={usage.cpuCores} />
                        </Gtk.Box>
                        <Gtk.Box
                            spacing={8}
                            visible={usage.tempAvailable}
                            tooltipText={computed(() =>
                                isRemote()
                                    ? remote.tempDescription()
                                    : 'Sensor local de temperatura'
                            )}
                        >
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label={isRemote.as((value) =>
                                    value ? 'Temperatura · sensor máximo' : 'Temperatura'
                                )}
                                hexpand
                                xalign={0}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                widthChars={7}
                                xalign={1}
                                label={usage.temp.as((value) => `${Math.round(value * 100)} °C`)}
                            />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="Memória" value={usage.memoryBytes.as(storageText)} />
                        <Gtk.Box visible={showGraphs}>
                            <UsageGraph
                                values={usage.memoryHistory}
                                capacity={HISTORY_LENGTH}
                                max={1}
                                cssClasses={['success']}
                            />
                        </Gtk.Box>
                        <Gtk.Box spacing={8} visible={memoryDetails.as((value) => value !== null)}>
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label="Disponível"
                                hexpand
                                xalign={0}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                label={memoryDetails.as((value) =>
                                    GLib.format_size(value?.available ?? 0)
                                )}
                            />
                        </Gtk.Box>
                        <Gtk.Box spacing={8} visible={memoryDetails.as((value) => value !== null)}>
                            <Gtk.Label
                                cssClasses={['caption', 'dimmed']}
                                label="Livre · cache"
                                hexpand
                                xalign={0}
                            />
                            <Gtk.Label
                                cssClasses={['caption', 'numeric']}
                                label={memoryDetails.as(
                                    (value) =>
                                        `${GLib.format_size(value?.free ?? 0)} · ${GLib.format_size(value?.cached ?? 0)}`
                                )}
                            />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader
                            title={computed(() => {
                                const name = isRemote()
                                    ? settings.systemUsageRemoteNetworkInterface()
                                    : settings.systemUsageNetworkInterface();
                                return `Rede (${name || 'todas'})`;
                            })}
                            value={computed(() =>
                                usage.netAvailable() && ratesReady()
                                    ? `↓ ${rateText(usage.net().rx, bits())}  ↑ ${rateText(usage.net().tx, bits())}`
                                    : 'Indisponível'
                            )}
                        />
                        <Gtk.Box visible={showGraphs}>
                            <UsageGraph
                                values={usage.netRxHistory}
                                secondary={usage.netTxHistory}
                                capacity={HISTORY_LENGTH}
                                cssClasses={['warning']}
                            />
                        </Gtk.Box>
                    </Gtk.Box>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        <SectionHeader title="Armazenamento" value={diskDetails} />
                        <MeterRow
                            title={diskTitle}
                            fraction={usage.disk}
                            detail={diskDetails}
                            visible={usage.diskAvailable}
                        />
                        <MeterRow
                            title="Swap"
                            fraction={usage.swapBytes.as(({used, total}) =>
                                total > 0 ? used / total : 0
                            )}
                            detail={usage.swapBytes.as(storageText)}
                            visible={usage.swapBytes.as(({total}) => total > 0)}
                        />
                    </Gtk.Box>
                    <Gtk.Box
                        visible={isRemote.as((value) => !value)}
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={12}
                    >
                        <BatterySection />
                        <ProcessesSection />
                    </Gtk.Box>
                    <Gtk.Label
                        visible={isRemote}
                        label="Processos e bateria disponíveis apenas no computador local."
                        tooltipText="O node_exporter não fornece a lista de processos ou a bateria deste computador."
                        xalign={0}
                        ellipsize={Pango.EllipsizeMode.END}
                        maxWidthChars={55}
                        cssClasses={['caption', 'dimmed']}
                    />
                    <Gtk.Box spacing={8}>
                        <Gtk.Label
                            cssClasses={['caption', 'numeric']}
                            ellipsize={Pango.EllipsizeMode.END}
                            maxWidthChars={22}
                            label={computed(
                                () =>
                                    `Ativo há ${formatUptime(usage.uptime())} · ${intervalLabel()}`
                            )}
                            hexpand
                            xalign={0}
                        />
                        <Gtk.Button label="Personalizar" onClicked={() => openSettings('bar')} />
                        <Gtk.Button
                            label="Abrir monitor"
                            visible={computed(
                                () => !isRemote() && settings.systemMonitor().trim().length > 0
                            )}
                            onClicked={onOpenMonitor}
                        />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.ScrolledWindow>
    );
}

const Indicator = ({
    value,
    label,
    unit,
    vertical,
    visible = true,
    style,
}: {
    value: Accessor<number>;
    label: string;
    unit: string;
    vertical: Accessor<boolean>;
    visible?: Accessor<boolean> | boolean;
    style: Accessor<string>;
}) => {
    const formatted = value.as((v) => `${(v * 100).toFixed(0)}${unit}`);
    return (
        <Gtk.Box visible={visible} spacing={2} orientation={Gtk.Orientation.VERTICAL}>
            <Gtk.Box
                spacing={vertical.as((v) => (v ? 0 : 4))}
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
            >
                <Gtk.Label
                    visible={style.as((s) => s !== 'compact')}
                    label={label}
                    tooltipText={label}
                    maxWidthChars={vertical.as((v) => (v ? 4 : -1))}
                    ellipsize={Pango.EllipsizeMode.END}
                    cssClasses={['caption-heading', 'numeric']}
                />
                <Gtk.Label
                    cssClasses={['caption', 'numeric']}
                    label={formatted}
                    tooltipText={formatted}
                    widthChars={4}
                    maxWidthChars={5}
                    xalign={1}
                    ellipsize={Pango.EllipsizeMode.END}
                />
            </Gtk.Box>
            <Gtk.LevelBar
                visible={style.as((s) => s === 'bars')}
                orientation={vertical.as((v) =>
                    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                inverted={vertical}
                value={value}
                widthRequest={vertical.as((v) => (v ? -1 : 50))}
                heightRequest={vertical.as((v) => (v ? 50 : -1))}
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
    const local = SystemUsage.get_default();
    const remote = RemoteSystemUsage.get_default();
    const isRemote = settings.systemUsageSource.as((source) => source === 'homelab');
    const usage = projectMetrics(local, remote, isRemote);
    effect(() => {
        const options: UsageOptions = {
            intervalMs: settings.systemUsageInterval(),
            networkInterface: settings.systemUsageNetworkInterface(),
            diskPath: settings.systemUsageDiskPath(),
            processSort: settings.systemUsageProcessSort() as 'cpu' | 'memory',
            processCount: settings.systemUsageProcessCount(),
            tempPath: settings.tempPath(),
        };
        untrack(() => local.configure(options));
    });
    effect(() => {
        const options = {
            url: settings.systemUsageRemoteUrl(),
            intervalMs: settings.systemUsageRemoteInterval(),
            networkInterface: settings.systemUsageRemoteNetworkInterface(),
            diskPath: settings.systemUsageRemoteDiskPath(),
        };
        untrack(() => remote.configure(options));
    });
    effect(() => {
        if (!(typeof visible === 'boolean' ? visible : visible())) return;
        const remoteSelected = isRemote();
        const release = untrack(() => (remoteSelected ? remote.subscribe() : local.subscribe()));
        onCleanup(release);
    });
    let popover: Gtk.Popover | null = null;
    let popoverShown = false;
    let releaseProcesses: (() => void) | null = null;
    let releaseBattery: (() => void) | null = null;
    const syncSubscriptions = () => {
        if (popoverShown && !isRemote()) {
            if (settings.systemUsageShowProcesses())
                releaseProcesses ??= local.subscribeProcesses();
            else {
                releaseProcesses?.();
                releaseProcesses = null;
            }
            releaseBattery ??= BatteryHistory.get_default().subscribe();
        } else {
            releaseProcesses?.();
            releaseProcesses = null;
            releaseBattery?.();
            releaseBattery = null;
        }
    };
    effect(() => {
        isRemote();
        settings.systemUsageShowProcesses();
        untrack(syncSubscriptions);
    });
    const stop = () => {
        popoverShown = false;
        syncSubscriptions();
    };
    onCleanup(stop);
    const openMonitor = () => {
        if (isRemote()) return;
        popover?.popdown();
        const command = settings.systemMonitor();
        if (command) local.launchMonitor(command);
    };
    const available = computed(
        () => !isRemote() || (remote.hasSample() && remote.state() === 'ready')
    );
    const ratesReady = computed(() => available() && (!isRemote() || remote.ratesReady()));
    const cpuOn = computed(() => settings.showCpuUsage() && ratesReady());
    const memoryOn = computed(() => settings.showMemoryUsage() && available());
    const tempOn = computed(
        () => settings.showTemperature() && available() && usage.tempAvailable()
    );
    const diskOn = computed(() => settings.showDiskUsage() && available() && usage.diskAvailable());
    const networkOn = computed(
        () => settings.showNetworkUsage() && ratesReady() && usage.netAvailable()
    );
    const swapOn = computed(
        () => settings.showSwapUsage() && available() && usage.swapBytes().total > 0
    );
    const anyMetric = computed(
        () => cpuOn() || memoryOn() || tempOn() || diskOn() || networkOn() || swapOn()
    );
    const style = settings.resourceIndicatorStyle;
    const bits = settings.networkRateUnit.as((value) => value === 'bits');
    const tooltip = computed(() => {
        if (isRemote() && remote.state() === 'error')
            return `Homelab indisponível: ${remote.error()}`;
        if (isRemote() && !remote.hasSample()) return 'Conectando ao homelab…';
        const source = isRemote() ? remote.hostname() || 'Homelab' : 'Local';
        return `${source} · CPU ${ratesReady() ? percent(usage.cpu()) : '—'} · RAM ${percent(usage.memory())}`;
    });
    return (
        <Gtk.MenuButton
            visible={visible}
            cssClasses={vertical.as((value) =>
                value ? ['flat', 'bar-vertical-content-button'] : ['flat']
            )}
            cursor={Gdk.Cursor.new_from_name('pointer', null)}
            tooltipText={tooltip}
            ref={(self) => {
                usePopoverCleanup(self);
                effect(() => setAccessibleName(`Recursos do sistema: ${tooltip()}`)(self));
            }}
        >
            <Gtk.Popover
                slot="popover"
                ref={(self) => {
                    popover = self;
                    self.connect('show', () => {
                        popoverShown = true;
                        syncSubscriptions();
                    });
                    self.connect('hide', stop);
                }}
            >
                <SystemUsagePopover onOpenMonitor={openMonitor} usage={usage} isRemote={isRemote} />
            </Gtk.Popover>
            <Gtk.Box
                orientation={vertical.as((value) =>
                    value ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                )}
                spacing={8}
            >
                <Gtk.Image
                    visible={isRemote}
                    iconName={remote.state.as((state) =>
                        state === 'error' ? 'network-offline-symbolic' : 'network-server-symbolic'
                    )}
                    tooltipText={tooltip}
                />
                <Gtk.Image
                    visible={computed(() => !isRemote() && !anyMetric())}
                    iconName="computer-symbolic"
                />
                <Gtk.Box
                    visible={anyMetric}
                    orientation={vertical.as((value) =>
                        value ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                    )}
                    spacing={12}
                >
                    <Indicator
                        visible={cpuOn}
                        vertical={vertical}
                        value={usage.cpu}
                        label="CPU"
                        unit="%"
                        style={style}
                    />
                    <Indicator
                        visible={memoryOn}
                        vertical={vertical}
                        value={usage.memory}
                        label="RAM"
                        unit="%"
                        style={style}
                    />
                    <Indicator
                        visible={tempOn}
                        vertical={vertical}
                        value={usage.temp}
                        label="TEMP"
                        unit="°C"
                        style={style}
                    />
                    <Indicator
                        visible={diskOn}
                        vertical={vertical}
                        value={usage.disk}
                        label="DISK"
                        unit="%"
                        style={style}
                    />
                    <Indicator
                        visible={swapOn}
                        vertical={vertical}
                        value={usage.swapBytes.as(({used, total}) =>
                            total > 0 ? used / total : 0
                        )}
                        label="SWAP"
                        unit="%"
                        style={style}
                    />
                    <Gtk.Box
                        visible={networkOn}
                        orientation={vertical.as((value) =>
                            value ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL
                        )}
                        spacing={2}
                    >
                        <Gtk.Label
                            visible={style.as((value) => value !== 'compact')}
                            cssClasses={['caption-heading', 'numeric']}
                            label="NET"
                        />
                        <Gtk.Label
                            cssClasses={['caption', 'numeric']}
                            maxWidthChars={26}
                            ellipsize={Pango.EllipsizeMode.END}
                            label={usage.net.as(
                                ({rx, tx}) => `↓${rateText(rx, bits())} ↑${rateText(tx, bits())}`
                            )}
                        />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Box>
        </Gtk.MenuButton>
    );
};
