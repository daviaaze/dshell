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
                    onNotifyActive={(self) => settings.setNotificationLockscreenContent(self.active)}
                />
                <Adw.SpinRow
                    title={'Limite do histórico'}
                    subtitle={'Quantidade máxima de notificações no histórico.'}
                    adjustment={historyLimitAdjustment}
                    onNotifyValue={(self) => settings.setNotificationHistoryLimit(self.value)}
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
                                cssClasses={['circular', 'destructive-action']}
                                iconName="list-remove-symbolic"
                                onClicked={() => {
                                    const current = settings.notificationIgnoredApps();
                                    logger.info('settings', `ignore app removed: ${app}`);
                                    settings.setNotificationIgnoredApps(current.filter((a) => a !== app));
                                }}
                            />
                        </Adw.ActionRow>
                    )}
                </For>
            </Adw.PreferencesGroup>
        </>
    );
}

/** Freedesktop sound-theme alert toggles. */
function SoundAlertsGroup({settings}: {settings: Settings}) {
    return (
        <Adw.PreferencesGroup
            title={'Alertas sonoros'}
            description={'Sons do sistema usando o tema de sons freedesktop.'}
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
                subtitle={'Reproduzir quando a bateria estiver baixa.'}
                active={settings.soundAlertBattery}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertBattery(self.active)}
            />
            <Adw.SwitchRow
                title={'Sons do sistema'}
                subtitle={'Bloqueio, desbloqueio, energia e conexão de dispositivos.'}
                active={settings.soundAlertSystem}
                sensitive={settings.soundAlertsEnabled}
                onNotifyActive={(self) => settings.setSoundAlertSystem(self.active)}
            />
        </Adw.PreferencesGroup>
    );
}

export default () => {
    const settings = generalSettings();

    return (
        <>
            <NotificationsGroup settings={settings} />
            <SoundAlertsGroup settings={settings} />
        </>
    );
};
