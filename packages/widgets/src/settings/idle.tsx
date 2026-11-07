import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {type Accessor, onCleanup} from 'gnim';

/** A SpinRow whose adjustment is rebuilt whenever its value or reload
 *  accessors change, so bounds track dependent settings live. */
function TimedSpinRow({
    title,
    subtitle,
    value,
    lower,
    upper,
    reloads = [],
    setter,
    sensitive = true,
    step = 30,
}: {
    title: string;
    subtitle: string;
    value: Accessor<number>;
    lower: () => number;
    upper: () => number;
    reloads?: Accessor<number>[];
    setter: (v: number) => void;
    sensitive?: Accessor<boolean> | boolean;
    step?: number;
}) {
    return (
        <Adw.SpinRow
            title={title}
            subtitle={subtitle}
            sensitive={sensitive}
            ref={(self) => {
                const apply = () => {
                    self.adjustment = new Gtk.Adjustment({
                        lower: lower(),
                        upper: upper(),
                        stepIncrement: step,
                        value: value(),
                    });
                };
                const unsubs = [value, ...reloads].map((a) => a.subscribe(apply));
                onCleanup(() => unsubs.forEach((un) => un()));
                apply();
            }}
            onNotifyValue={(self) => setter(self.value)}
        />
    );
}

export default () => {
    const settings = generalSettings();

    return (
        <>
            <Adw.PreferencesGroup
                title={'Bloqueio de sessão'}
                description={'Inatividade antes do bloqueio; duração em segundos.'}
            >
            <Adw.SwitchRow
                title={'Bloquear automaticamente'}
                subtitle={'Bloquear a sessão após o tempo de inatividade.'}
                active={settings.autoLockEnabled}
                onNotifyActive={(self) => settings.setAutoLockEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Tempo de inatividade antes do bloqueio'}
                subtitle={'Duração em segundos antes de bloquear a sessão.'}
                value={settings.idleTimeout}
                lower={() => 60}
                upper={() => 1800}
                setter={(v) => settings.setIdleTimeout(v)}
            />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title={'Escurecer e desligar tela'}
                description={'Durações em segundos; os controles dependem de suas opções.'}
            >
            <Adw.SwitchRow
                title={'Escurecer antes do bloqueio'}
                subtitle={'Reduzir o brilho antes do bloqueio automático.'}
                active={settings.screenDimEnabled}
                sensitive={settings.autoLockEnabled}
                onNotifyActive={(self) => settings.setScreenDimEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Começar a escurecer'}
                subtitle={'Segundos de inatividade; limitado pelo tempo de bloqueio.'}
                value={settings.screenDimTimeout}
                sensitive={settings.screenDimEnabled}
                lower={() => 30}
                upper={() => Math.max(30, settings.idleTimeout() - 10)}
                reloads={[settings.idleTimeout]}
                setter={(v) => settings.setScreenDimTimeout(v)}
            />
            <Adw.SwitchRow
                title={'Desligar tela após inatividade'}
                subtitle={'Desligar a tela via DPMS, sem suspender o sistema.'}
                active={settings.dpmsEnabled}
                sensitive={settings.autoLockEnabled}
                onNotifyActive={(self) => settings.setDpmsEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Desligar tela após'}
                subtitle={'Segundos de inatividade antes de desligar a tela.'}
                value={settings.dpmsTimeout}
                sensitive={settings.dpmsEnabled}
                lower={() => settings.idleTimeout() + 10}
                upper={() => 3600}
                reloads={[settings.idleTimeout]}
                setter={(v) => settings.setDpmsTimeout(v)}
            />
            </Adw.PreferencesGroup>
            <Adw.PreferencesGroup
                title={'Suspender'}
                description={'Suspensão automática após inatividade.'}
            >
            <Adw.SwitchRow
                title={'Suspender automaticamente'}
                subtitle={'Suspender o sistema após inatividade prolongada.'}
                active={settings.suspendEnabled}
                onNotifyActive={(self) => settings.setSuspendEnabled(self.active)}
            />
            <TimedSpinRow
                title={'Suspender após'}
                subtitle={'Segundos; ative a suspensão automática para editar.'}
                value={settings.suspendTimeout}
                lower={() => settings.dpmsTimeout() + 10}
                upper={() => 7200}
                reloads={[settings.dpmsTimeout]}
                step={60}
                sensitive={settings.suspendEnabled}
                setter={(v) => settings.setSuspendTimeout(v)}
            />
        </Adw.PreferencesGroup>
        </>
    );
};
