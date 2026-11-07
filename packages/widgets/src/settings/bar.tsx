import Adw from 'gi://Adw?version=1';
import Astal from 'gi://Astal?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {barSettings} from '@shade/services/settings/bar.gschema';
import {For, onCleanup} from 'gnim';

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
        <Adw.PreferencesGroup title="Borda da barra" description="Escolha em qual borda da tela a barra aparece.">
            <Adw.ActionRow title="Posição" subtitle={bar.position.as(positionLabel)}>
                <Adw.ToggleGroup
                    slot="suffix"
                    cssClasses={['round']}
                    valign={Gtk.Align.CENTER}
                    ref={(self) => {
                        self.add(new Adw.Toggle({name: TOP.toString(), label: 'Superior', iconName: 'orientation-landscape-symbolic'}));
                        self.add(new Adw.Toggle({name: LEFT.toString(), label: 'Esquerda', iconName: 'orientation-portrait-inverse-symbolic'}));
                        self.add(new Adw.Toggle({name: RIGHT.toString(), label: 'Direita', iconName: 'orientation-portrait-right-symbolic'}));
                        self.add(new Adw.Toggle({name: BOTTOM.toString(), label: 'Inferior', iconName: 'orientation-landscape-inverse-symbolic'}));
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

            <Adw.SwitchRow
                title="Mostrar uso do disco"
                active={bar.showDiskUsage}
                onNotifyActive={(self) => bar.setShowDiskUsage(self.active)}
            />
            <Adw.EntryRow
                title="Caminho do sensor de temperatura"
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

/** Dock group: enable, auto-hide, icon size. */
function DockGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup title="Dock" description="Visibilidade, ocultação automática e tamanho dos ícones.">
            <Adw.SwitchRow
                title="Mostrar dock"
                active={bar.dockEnabled}
                onNotifyActive={(self) => bar.setDockEnabled(self.active)}
            />
            <Adw.SwitchRow
                title="Ocultar automaticamente"
                active={bar.dockAutoHide}
                onNotifyActive={(self) => bar.setDockAutoHide(self.active)}
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
                onNotifyValue={(self) => bar.setDockIconSize(self.value)}
            />
        </Adw.PreferencesGroup>
    );
}

/** Pinned-apps group: add entry plus removable rows per pinned app. */
function PinnedAppsGroup({bar}: {bar: Bar}) {
    return (
        <Adw.PreferencesGroup title="Aplicativos fixados" description="Adicione ou remova IDs de aplicativos desktop; o nome é mostrado quando disponível.">
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
                    <Adw.ActionRow title={appId} subtitle="ID do aplicativo desktop">
                        <Gtk.Button
                            slot="suffix"
                            cssClasses={['circular', 'destructive-action']}
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
        <Adw.PreferencesGroup title="Visibilidade dos itens" description="Escolha quais acessos, clientes e indicadores aparecem na barra.">
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

export default () => {
    const bar = barSettings();

    return (
        <>
            <BarGroup bar={bar} />
            <DockGroup bar={bar} />
            <PinnedAppsGroup bar={bar} />
            <ModulesGroup bar={bar} />
        </>
    );
};
