import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import type Tray from 'gi://AstalTray';
import Gtk from 'gi://Gtk?version=4.0';
import TrayService from '@shade/services/desktop/trayService';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {type Accessor, bind, computed, For, onCleanup} from 'gnim';
import {getAppList} from '@shade/services/state/apps';
import SystemUsage from '@shade/services/monitoring/systemUsage';
import {isTrayItemHidden, trayItemKey} from '../common/trayItem';

const {TOP, LEFT, RIGHT, BOTTOM} = Astal.WindowAnchor;

type Bar = ReturnType<typeof barSettings>;

function positionLabel(p: Astal.WindowAnchor): string {
    switch (p) {
        case TOP:
            return 'Superior';
        case LEFT:
            return 'Esquerda';
        case RIGHT:
            return 'Direita';
        case BOTTOM:
            return 'Inferior';
        default:
            return '';
    }
}

/** Bar group: position toggle plus misc paths. */
function BarGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup
            title="Borda da barra"
            description="Escolha em qual borda da tela a barra aparece."
        >
            <Adw.ActionRow title="Posição" subtitle={bar.position.as(positionLabel)}>
                <Adw.ToggleGroup
                    slot="suffix"
                    cssClasses={['round']}
                    valign={Gtk.Align.CENTER}
                    ref={(self) => {
                        self.add(
                            new Adw.Toggle({
                                name: TOP.toString(),
                                label: 'Superior',
                                iconName: 'orientation-landscape-symbolic',
                            })
                        );
                        self.add(
                            new Adw.Toggle({
                                name: LEFT.toString(),
                                label: 'Esquerda',
                                iconName: 'orientation-portrait-inverse-symbolic',
                            })
                        );
                        self.add(
                            new Adw.Toggle({
                                name: RIGHT.toString(),
                                label: 'Direita',
                                iconName: 'orientation-portrait-right-symbolic',
                            })
                        );
                        self.add(
                            new Adw.Toggle({
                                name: BOTTOM.toString(),
                                label: 'Inferior',
                                iconName: 'orientation-landscape-inverse-symbolic',
                            })
                        );
                        self.activeName = String(bar.position.peek());
                        const changed = self.connect('notify::active-name', () => {
                            if (self.activeName === null) return;
                            const position = Number(self.activeName) as Astal.WindowAnchor;
                            if (position !== bar.position.peek()) bar.setPosition(position);
                        });
                        const unsubscribe = bar.position.subscribe(() => {
                            self.activeName = String(bar.position());
                        });
                        onCleanup(() => {
                            unsubscribe();
                            self.disconnect(changed);
                            self.remove_all();
                        });
                    }}
                />
            </Adw.ActionRow>

            <Adw.EntryRow
                title="Caminho do sensor de temperatura (vazio: automático)"
                showApplyButton
                text={bar.tempPath() ?? ''}
                onEntryActivated={(self) => bar.setTempPath(self.text)}
                onApply={(self) => bar.setTempPath(self.text)}
            />
            <Adw.EntryRow
                title="Comando do monitor do sistema"
                showApplyButton
                text={bar.systemMonitor() ?? ''}
                onEntryActivated={(self) => bar.setSystemMonitor(self.text)}
                onApply={(self) => bar.setSystemMonitor(self.text)}
            />
        </Adw.PreferencesGroup>
    );
}

const AGGREGATE_INTERFACE = '(Agregado)';

/** Interface picker whose list follows the detected interfaces; a stored interface that is absent stays selectable. */
function NetworkInterfaceDropDown({bar, choices}: {bar: Bar; choices: Accessor<string[]>}) {
    let options: string[] = [];
    let syncing = false;
    return (
        <Gtk.DropDown
            slot="suffix"
            valign={Gtk.Align.CENTER}
            ref={(self) => {
                const sync = () => {
                    const stored = bar.systemUsageNetworkInterface.peek();
                    const detected = choices.peek();
                    options =
                        stored && !detected.includes(stored) ? [...detected, stored] : detected;
                    syncing = true;
                    self.model = Gtk.StringList.new(options);
                    self.selected = Math.max(0, options.indexOf(stored || AGGREGATE_INTERFACE));
                    syncing = false;
                };
                onCleanup(choices.subscribe(sync));
                sync();
            }}
            onNotifySelected={(self) => {
                if (syncing) return;
                const selected = options[self.selected];
                if (self.selected === 0) bar.setSystemUsageNetworkInterface('');
                else if (selected) bar.setSystemUsageNetworkInterface(selected);
            }}
        />
    );
}

function ResourceSettingsGroup({bar}: {bar: Bar}) {
    const interfaces = SystemUsage.get_default().networkInterfaces;
    const interfaceChoices = computed(() => [AGGREGATE_INTERFACE, ...interfaces()]);
    const styleOptions = ['bars', 'text', 'compact'];
    const rateOptions = ['bytes', 'bits'];
    const sortOptions = ['cpu', 'memory'];
    const styleModel = Gtk.StringList.new(['Barras', 'Texto', 'Compacto']);
    const rateModel = Gtk.StringList.new(['Bytes/s', 'Bits/s']);
    const sortModel = Gtk.StringList.new(['CPU', 'Memória']);
    return (
        <>
            <Adw.PreferencesGroup title="Recursos na barra">
                <Adw.SwitchRow
                    title="CPU"
                    active={bar.showCpuUsage}
                    onNotifyActive={(self) => bar.setShowCpuUsage(self.active)}
                />
                <Adw.SwitchRow
                    title="Memória"
                    active={bar.showMemoryUsage}
                    onNotifyActive={(self) => bar.setShowMemoryUsage(self.active)}
                />
                <Adw.SwitchRow
                    title="Temperatura"
                    active={bar.showTemperature}
                    onNotifyActive={(self) => bar.setShowTemperature(self.active)}
                />
                <Adw.SwitchRow
                    title="Rede"
                    active={bar.showNetworkUsage}
                    onNotifyActive={(self) => bar.setShowNetworkUsage(self.active)}
                />
                <Adw.SwitchRow
                    title="Swap"
                    active={bar.showSwapUsage}
                    onNotifyActive={(self) => bar.setShowSwapUsage(self.active)}
                />
                <Adw.SwitchRow
                    title="Disco"
                    active={bar.showDiskUsage}
                    onNotifyActive={(self) => bar.setShowDiskUsage(self.active)}
                />
                <Adw.ComboRow
                    title="Estilo dos indicadores"
                    model={styleModel}
                    selected={bar.resourceIndicatorStyle.as((style) =>
                        Math.max(0, styleOptions.indexOf(style))
                    )}
                    onNotifySelected={(row) => {
                        const value = styleOptions[row.selected];
                        if (value) bar.setResourceIndicatorStyle(value);
                    }}
                />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup title="Monitoramento do sistema">
                <Adw.ComboRow
                    title="Unidade da taxa de rede"
                    model={rateModel}
                    selected={bar.networkRateUnit.as((unit) =>
                        Math.max(0, rateOptions.indexOf(unit))
                    )}
                    onNotifySelected={(row) => {
                        const value = rateOptions[row.selected];
                        if (value) bar.setNetworkRateUnit(value);
                    }}
                />
                <Adw.SpinRow
                    title="Intervalo de atualização"
                    subtitle="500–5000 ms"
                    adjustment={
                        new Gtk.Adjustment({
                            lower: 500,
                            upper: 5000,
                            stepIncrement: 100,
                            pageIncrement: 500,
                            value: bar.systemUsageInterval(),
                        })
                    }
                    onNotifyValue={(row) => bar.setSystemUsageInterval(Math.round(row.value))}
                />
                <Adw.ActionRow
                    title="Interface de rede"
                    subtitle={computed(
                        () =>
                            bar.systemUsageNetworkInterface() ||
                            `Agregado: ${interfaceChoices().slice(1).join(', ') || 'sem interfaces detectadas'}`
                    )}
                >
                    <NetworkInterfaceDropDown bar={bar} choices={interfaceChoices} />
                </Adw.ActionRow>
                <Adw.EntryRow
                    title="Caminho do filesystem"
                    tooltipText="Padrão: /"
                    showApplyButton
                    text={bar.systemUsageDiskPath()}
                    onEntryActivated={(self) => bar.setSystemUsageDiskPath(self.text)}
                    onApply={(self) => bar.setSystemUsageDiskPath(self.text)}
                />
                <Adw.ComboRow
                    title="Ordenar processos por"
                    model={sortModel}
                    selected={bar.systemUsageProcessSort.as((sort) =>
                        Math.max(0, sortOptions.indexOf(sort))
                    )}
                    onNotifySelected={(row) => {
                        const value = sortOptions[row.selected];
                        if (value) bar.setSystemUsageProcessSort(value);
                    }}
                />
                <Adw.SpinRow
                    title="Quantidade de processos"
                    adjustment={
                        new Gtk.Adjustment({
                            lower: 3,
                            upper: 15,
                            stepIncrement: 1,
                            pageIncrement: 3,
                            value: bar.systemUsageProcessCount(),
                        })
                    }
                    onNotifyValue={(row) => bar.setSystemUsageProcessCount(Math.round(row.value))}
                />
                <Adw.SwitchRow
                    title="Gráficos"
                    active={bar.systemUsageShowGraphs}
                    onNotifyActive={(self) => bar.setSystemUsageShowGraphs(self.active)}
                />
                <Adw.SwitchRow
                    title="Processos principais"
                    active={bar.systemUsageShowProcesses}
                    onNotifyActive={(self) => bar.setSystemUsageShowProcesses(self.active)}
                />
                <Adw.SwitchRow
                    title="Uso por núcleo"
                    active={bar.systemUsageShowPerCore}
                    onNotifyActive={(self) => bar.setSystemUsageShowPerCore(self.active)}
                />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup title="Fonte de uso do sistema">
                <Adw.ComboRow
                    title="Origem"
                    subtitle={computed(() =>
                        bar.systemUsageSource() === 'homelab'
                            ? 'Métricas do servidor homelab'
                            : 'Este computador'
                    )}
                    model={Gtk.StringList.new(['Local', 'Homelab'])}
                    selected={bar.systemUsageSource.as((source) => (source === 'homelab' ? 1 : 0))}
                    onNotifySelected={(row) =>
                        bar.setSystemUsageSource(row.selected === 1 ? 'homelab' : 'local')
                    }
                />
                <Adw.EntryRow
                    title="URL node_exporter"
                    showApplyButton
                    text={bar.systemUsageRemoteUrl()}
                    onEntryActivated={(self) => bar.setSystemUsageRemoteUrl(self.text)}
                    onApply={(self) => bar.setSystemUsageRemoteUrl(self.text)}
                />
                <Adw.SpinRow
                    title="Intervalo remoto"
                    subtitle="2000–60000 ms"
                    adjustment={
                        new Gtk.Adjustment({
                            lower: 2000,
                            upper: 60000,
                            stepIncrement: 1000,
                            pageIncrement: 5000,
                            value: bar.systemUsageRemoteInterval(),
                        })
                    }
                    onNotifyValue={(row) => bar.setSystemUsageRemoteInterval(Math.round(row.value))}
                />
                <Adw.EntryRow
                    title="Interface de rede remota"
                    tooltipText="Vazio agrega o tráfego de interfaces que não sejam loopback"
                    showApplyButton
                    text={bar.systemUsageRemoteNetworkInterface()}
                    onEntryActivated={(self) => bar.setSystemUsageRemoteNetworkInterface(self.text)}
                    onApply={(self) => bar.setSystemUsageRemoteNetworkInterface(self.text)}
                />
                <Adw.EntryRow
                    title="Caminho do filesystem remoto"
                    showApplyButton
                    text={bar.systemUsageRemoteDiskPath()}
                    onEntryActivated={(self) => bar.setSystemUsageRemoteDiskPath(self.text)}
                    onApply={(self) => bar.setSystemUsageRemoteDiskPath(self.text)}
                />
                <Adw.ActionRow
                    title="Segurança da conexão"
                    subtitle="HTTP não cifra o tráfego; use somente em uma rede local confiável. Não salve credenciais nesta URL."
                />
            </Adw.PreferencesGroup>
        </>
    );
}

/** Dock group: enable, auto-hide, icon size. */
function DockGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup title="Dock" description="Visibilidade e tamanho dos ícones.">
            <Adw.SwitchRow
                title="Mostrar dock"
                active={bar.dockEnabled}
                onNotifyActive={(self) => bar.setDockEnabled(self.active)}
            />
            <Adw.SpinRow
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: 24,
                        upper: 64,
                        stepIncrement: 4,
                        value: bar.dockIconSize(),
                    });
                }}
                title="Tamanho dos ícones"
                onNotifyValue={(self) => bar.setDockIconSize(Math.round(self.value))}
            />
        </Adw.PreferencesGroup>
    );
}

/** Pinned-apps group: add entry plus removable rows per pinned app. */
/** Display name of a pinned desktop ID, falling back to the ID itself. */
function pinnedAppName(appId: string): string {
    const id = appId.replace(/\.desktop$/i, '').toLowerCase();
    const app = getAppList().find(
        (item) => item.entry?.replace(/\.desktop$/i, '').toLowerCase() === id
    );
    return app?.name || appId;
}

function PinnedAppsGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup
            title="Aplicativos fixados"
            description="Adicione ou remova IDs de aplicativos desktop; o nome do aplicativo é mostrado quando disponível."
        >
            <Adw.EntryRow
                title="Adicionar aplicativo"
                showApplyButton
                onApply={(self) => {
                    const id = self.text.trim();
                    if (!id) return;
                    const current = bar.dockPinnedApps();
                    if (!current.includes(id)) {
                        bar.setDockPinnedApps([...current, id]);
                    }
                    self.text = '';
                }}
            />
            <For each={bar.dockPinnedApps}>
                {(appId: string) => (
                    <Adw.ActionRow title={pinnedAppName(appId)} subtitle={appId}>
                        <Gtk.Button
                            slot="suffix"
                            cssClasses={['circular', 'flat']}
                            iconName="list-remove-symbolic"
                            onClicked={() => {
                                const current = bar.dockPinnedApps();
                                bar.setDockPinnedApps(current.filter((a) => a !== appId));
                            }}
                        />
                    </Adw.ActionRow>
                )}
            </For>
        </Adw.PreferencesGroup>
    );
}

/** Modules group: visibility toggles for bar components. */
function ModulesGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup
            title="Visibilidade dos itens"
            description="Escolha quais acessos, clientes e indicadores aparecem na barra."
        >
            <Adw.SwitchRow
                title="Abrir aplicativos"
                active={bar.showLauncher}
                onNotifyActive={(self) => bar.setShowLauncher(self.active)}
            />
            <Adw.SwitchRow
                title="Espaços de trabalho"
                active={bar.showWorkspaces}
                onNotifyActive={(self) => bar.setShowWorkspaces(self.active)}
            />
            <Adw.SwitchRow
                title="Título da janela"
                active={bar.showWindowTitle}
                onNotifyActive={(self) => bar.setShowWindowTitle(self.active)}
            />
            <Adw.SwitchRow
                title="Recursos do sistema"
                active={bar.showSystemResources}
                onNotifyActive={(self) => bar.setShowSystemResources(self.active)}
            />
            <Adw.SwitchRow
                title="Relógio"
                active={bar.showClock}
                onNotifyActive={(self) => bar.setShowClock(self.active)}
            />
            <Adw.SwitchRow
                title="Clima"
                active={bar.showWeather}
                onNotifyActive={(self) => bar.setShowWeather(self.active)}
            />
            <Adw.SwitchRow
                title="Indicadores do sistema"
                active={bar.showSystemIndicators}
                onNotifyActive={(self) => bar.setShowSystemIndicators(self.active)}
            />
            <Adw.SwitchRow
                title="Bateria de dispositivos Bluetooth"
                subtitle="Exibe o nível quando o dispositivo informa a bateria."
                active={bar.showBluetoothBattery}
                onNotifyActive={(self) => bar.setShowBluetoothBattery(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Per-app tray placement, keyed by the application's StatusNotifierItem ID. */
function TrayItemsGroup({bar}: {bar: Bar}) {
    const tray = TrayService.get_default();
    return (
        <Adw.PreferencesGroup
            title="Ícones da bandeja"
            description="Ativado: na barra. Desativado: somente nos Controles rápidos."
        >
            <For each={bind(tray, 'items')}>
                {(item: Tray.TrayItem) => {
                    const key = trayItemKey(item);
                    const title = bind(item, 'title');
                    const tooltip = bind(item, 'tooltip-text');
                    return (
                        <Adw.SwitchRow
                            sensitive={key !== ''}
                            title={computed(
                                () =>
                                    title() ||
                                    tooltip()?.split('\n')[0] ||
                                    key ||
                                    'Aplicativo da bandeja'
                            )}
                            subtitle={bar.hiddenTrayItems.as((ids) =>
                                isTrayItemHidden(item, ids) ? 'Nos Controles rápidos' : 'Na barra'
                            )}
                            active={bar.hiddenTrayItems.as((ids) => !isTrayItemHidden(item, ids))}
                            onNotifyActive={(self) => {
                                const hidden = bar.hiddenTrayItems();
                                if (self.active) {
                                    bar.setHiddenTrayItems(hidden.filter((id) => id !== key));
                                } else if (key && !hidden.includes(key)) {
                                    bar.setHiddenTrayItems([...hidden, key]);
                                }
                            }}
                        />
                    );
                }}
            </For>
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const bar = barSettings();

    return (
        <>
            <BarGroup bar={bar} />
            <DockGroup bar={bar} />
            <PinnedAppsGroup bar={bar} />
            <ResourceSettingsGroup bar={bar} />
            <ModulesGroup bar={bar} />
            <TrayItemsGroup bar={bar} />
        </>
    );
};
