import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {For} from 'gnim';

type Settings = ReturnType<typeof generalSettings>;

/** Notification behavior group — progress bar, history limit, ignored apps. */
function NotificationsGroup({settings}: {settings: Settings}) {
    const historyLimitAdjustment = new Gtk.Adjustment({
        lower: 20,
        upper: 500,
        stepIncrement: 10,
        pageIncrement: 50,
        value: settings.notificationHistoryLimit(),
    });

    return (
        <>
            <Adw.PreferencesGroup
                title={'Notificações'}
                description={'Apresentação, privacidade e histórico de notificações.'}
            >
                <Adw.SwitchRow
                    title={'Mostrar barra de progresso'}
                    subtitle={'Contagem regressiva nos avisos de notificação.'}
                    active={settings.notificationShowProgress}
                    onNotifyActive={(self) => settings.setNotificationShowProgress(self.active)}
                />
                <Adw.SwitchRow
                    title={'Mostrar conteúdo na tela bloqueada'}
                    subtitle={settings.notificationLockscreenContent.as((show) =>
                        show
                            ? 'Os detalhes ficam visíveis enquanto a sessão está bloqueada.'
                            : 'Os detalhes ficam ocultos até desbloquear a sessão.'
                    )}
                    active={settings.notificationLockscreenContent}
                    onNotifyActive={(self) =>
                        settings.setNotificationLockscreenContent(self.active)
                    }
                />
                <Adw.SpinRow
                    title={'Limite do histórico'}
                    subtitle={'Quantidade máxima de notificações no histórico.'}
                    adjustment={historyLimitAdjustment}
                    onNotifyValue={(self) =>
                        settings.setNotificationHistoryLimit(Math.round(self.value))
                    }
                />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title={'Aplicativos ignorados'}
                description={'Notificações destes aplicativos serão ignoradas.'}
            >
                <Adw.EntryRow
                    title={'Ignorar aplicativo'}
                    showApplyButton
                    onApply={(self) => {
                        const name = self.text.trim();
                        if (!name) return;
                        const current = settings.notificationIgnoredApps();
                        if (!current.includes(name)) {
                            logger.info('settings', `ignore app added: ${name}`);
                            settings.setNotificationIgnoredApps([...current, name]);
                        }
                        self.text = '';
                    }}
                />
                <For each={settings.notificationIgnoredApps}>
                    {(app: string) => (
                        <Adw.ActionRow title={app}>
                            <Gtk.Button
                                cssClasses={['circular', 'flat']}
                                iconName="list-remove-symbolic"
                                onClicked={() => {
                                    const current = settings.notificationIgnoredApps();
                                    logger.info('settings', `ignore app removed: ${app}`);
                                    settings.setNotificationIgnoredApps(
                                        current.filter((a) => a !== app)
                                    );
                                }}
                            />
                        </Adw.ActionRow>
                    )}
                </For>
            </Adw.PreferencesGroup>
        </>
    );
}

/** Native preference rows keep alert thresholds in percent and actual degrees Celsius. */
function SystemAlertsGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Alertas do sistema'}
            description={'Avisos visuais de bateria, energia, temperatura local e Bluetooth.'}
        >
            <Adw.SwitchRow
                title={'Bateria do computador'}
                subtitle={'Avisar apenas durante a descarga, sem alerta ao iniciar a sessão.'}
                active={settings.alertBatteryEnabled}
                onNotifyActive={(self) => settings.setAlertBatteryEnabled(self.active)}
            />
            <Adw.SpinRow
                title={'Bateria baixa (%)'}
                subtitle={'Novo aviso somente após recuperar pelo menos 5 pontos percentuais.'}
                sensitive={settings.alertBatteryEnabled}
                adjustment={new Gtk.Adjustment({lower: 10, upper: 50, stepIncrement: 1, pageIncrement: 5})}
                value={settings.alertBatteryLowThreshold}
                onNotifyValue={(self) => {
                    const value = Math.round(self.value);
                    if (settings.alertBatteryCriticalThreshold() >= value) {
                        settings.setAlertBatteryCriticalThreshold(value - 1);
                    }
                    settings.setAlertBatteryLowThreshold(value);
                }}
            />
            <Adw.SpinRow
                title={'Bateria crítica (%)'}
                subtitle={'Deve ser menor que o nível de bateria baixa.'}
                sensitive={settings.alertBatteryEnabled}
                adjustment={new Gtk.Adjustment({lower: 1, upper: 20, stepIncrement: 1, pageIncrement: 5})}
                value={settings.alertBatteryCriticalThreshold}
                onNotifyValue={(self) => {
                    const value = Math.min(Math.round(self.value), settings.alertBatteryLowThreshold() - 1);
                    if (self.value !== value) self.value = value;
                    settings.setAlertBatteryCriticalThreshold(value);
                }}
            />
            <Adw.SwitchRow
                title={'Conexão do carregador'}
                subtitle={'Avisar ao conectar ou desconectar a energia.'}
                active={settings.alertPowerEnabled}
                onNotifyActive={(self) => settings.setAlertPowerEnabled(self.active)}
            />
            <Adw.SwitchRow
                title={'Temperatura elevada'}
                subtitle={'Usa apenas o sensor local. Reativa após esfriar 5 °C; intervalo mínimo de 5 minutos.'}
                active={settings.alertTemperatureEnabled}
                onNotifyActive={(self) => settings.setAlertTemperatureEnabled(self.active)}
            />
            <Adw.SpinRow
                title={'Aviso de temperatura (°C)'}
                sensitive={settings.alertTemperatureEnabled}
                adjustment={new Gtk.Adjustment({lower: 50, upper: 110, stepIncrement: 1, pageIncrement: 5})}
                value={settings.alertTemperatureWarningThreshold}
                onNotifyValue={(self) => {
                    const value = Math.round(self.value);
                    if (settings.alertTemperatureCriticalThreshold() <= value) {
                        settings.setAlertTemperatureCriticalThreshold(value + 1);
                    }
                    settings.setAlertTemperatureWarningThreshold(value);
                }}
            />
            <Adw.SpinRow
                title={'Temperatura crítica (°C)'}
                subtitle={'Deve ser maior que o nível de aviso.'}
                sensitive={settings.alertTemperatureEnabled}
                adjustment={new Gtk.Adjustment({lower: 60, upper: 120, stepIncrement: 1, pageIncrement: 5})}
                value={settings.alertTemperatureCriticalThreshold}
                onNotifyValue={(self) => {
                    const value = Math.max(Math.round(self.value), settings.alertTemperatureWarningThreshold() + 1);
                    if (self.value !== value) self.value = value;
                    settings.setAlertTemperatureCriticalThreshold(value);
                }}
            />
            <Adw.SwitchRow
                title={'Conexões Bluetooth'}
                subtitle={'Avisar após a conexão ou desconexão ficar estável por 1 segundo.'}
                active={settings.alertBluetoothEnabled}
                onNotifyActive={(self) => settings.setAlertBluetoothEnabled(self.active)}
            />
            <Adw.SwitchRow
                title={'Bateria de dispositivos Bluetooth'}
                subtitle={'Um aviso por dispositivo conectado, sem repetir em reconexões rápidas.'}
                active={settings.alertBluetoothBatteryEnabled}
                onNotifyActive={(self) => settings.setAlertBluetoothBatteryEnabled(self.active)}
            />
            <Adw.SpinRow
                title={'Bateria baixa de dispositivos (%)'}
                sensitive={settings.alertBluetoothBatteryEnabled}
                adjustment={new Gtk.Adjustment({lower: 5, upper: 50, stepIncrement: 1, pageIncrement: 5})}
                value={settings.alertBluetoothBatteryThreshold}
                onNotifyValue={(self) => settings.setAlertBluetoothBatteryThreshold(Math.round(self.value))}
            />
        </Adw.PreferencesGroup>
    );
}

/** Freedesktop sound-theme alert toggles. */
function SoundAlertsGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Sons'}
            description={'Tema freedesktop. Todos os sons respeitam Não perturbe; os avisos visuais são independentes.'}
        >
            <Adw.SwitchRow
                title={'Ativar alertas sonoros'}
                subtitle={'Controle principal dos sons de alerta.'}
                active={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertsEnabled(self.active)}
            />
            <Adw.SwitchRow
                title={'Som de notificação'}
                subtitle={'Reproduzir ao receber uma notificação.'}
                active={settings.soundAlertNotification}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertNotification(self.active)}
            />
            <Adw.SwitchRow
                title={'Som de captura'}
                subtitle={'Reproduzir em capturas de imagem ou gravação.'}
                active={settings.soundAlertCapture}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertCapture(self.active)}
            />
            <Adw.SwitchRow
                title={'Aviso sonoro de bateria'}
                subtitle={'Reproduzir nos avisos de bateria baixa e crítica, incluindo dispositivos.'}
                active={settings.soundAlertBattery}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertBattery(self.active)}
            />
            <Adw.SwitchRow
                title={'Sons do sistema'}
                subtitle={'Bloqueio e desbloqueio da sessão.'}
                active={settings.soundAlertSystem}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertSystem(self.active)}
            />
            <Adw.SwitchRow
                title={'Som do carregador'}
                subtitle={'Reproduzir ao conectar ou desconectar a energia.'}
                active={settings.soundAlertPower}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertPower(self.active)}
            />
            <Adw.SwitchRow
                title={'Sons do Bluetooth'}
                subtitle={'Conexão e desconexão, sem rajadas em reconexões rápidas.'}
                active={settings.soundAlertBluetooth}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertBluetooth(self.active)}
            />
            <Adw.SwitchRow
                title={'Aviso sonoro de temperatura'}
                active={settings.soundAlertTemperature}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertTemperature(self.active)}
            />
            <Adw.SwitchRow
                title={'Som ao ajustar o volume'}
                subtitle={'Retorno sonoro da saída padrão, desativado por padrão.'}
                active={settings.soundAlertVolume}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertVolume(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const settings = generalSettings();

    return (
        <>
            <NotificationsGroup settings={settings} />
            <SystemAlertsGroup settings={settings} />
            <SoundAlertsGroup settings={settings} />
        </>
    );
};
