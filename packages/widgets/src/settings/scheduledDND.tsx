import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {generalSettings} from '@shade/core/settings/general.gschema';
import {computed} from 'gnim';

export default () => {
    const settings = generalSettings();

    return (
        <Adw.PreferencesGroup
            title="Agenda de não perturbe"
            description="Agenda salva e aplicada enquanto o shell estiver em execução, mesmo com as Configurações fechadas. Ao desativar, o estado anterior é restaurado somente se não houver uma alteração manual posterior."
        >
            <Adw.SwitchRow
                title="Ativar agenda"
                subtitle="Uma alteração manual do não perturbe vale até o próximo início ou término."
                active={settings.dndScheduleEnabled}
                onNotifyActive={(self) => settings.setDndScheduleEnabled(self.active)}
            />

            <Adw.SpinRow
                title="Começa às"
                subtitle="Hora local em formato de 24 horas."
                adjustment={new Gtk.Adjustment({
                    value: settings.dndScheduleStartHour(),
                    lower: 0,
                    upper: 23,
                    stepIncrement: 1,
                })}
                value={settings.dndScheduleStartHour}
                onNotifyValue={(self) =>
                    settings.setDndScheduleStartHour(Math.round(self.value))
                }
            >
                <Gtk.Label slot="suffix" label="h" />
            </Adw.SpinRow>

            <Adw.SpinRow
                title="Termina às"
                subtitle={computed(() => {
                    if (settings.dndScheduleStartHour() === settings.dndScheduleEndHour()) {
                        return 'Igual ao início: a agenda não ativa o não perturbe.';
                    }
                    return settings.dndScheduleStartHour() < settings.dndScheduleEndHour()
                        ? 'Hora local em formato de 24 horas, no mesmo dia.'
                        : 'Hora local em formato de 24 horas, no dia seguinte.';
                })}
                adjustment={new Gtk.Adjustment({
                    value: settings.dndScheduleEndHour(),
                    lower: 0,
                    upper: 23,
                    stepIncrement: 1,
                })}
                value={settings.dndScheduleEndHour}
                onNotifyValue={(self) =>
                    settings.setDndScheduleEndHour(Math.round(self.value))
                }
            >
                <Gtk.Label slot="suffix" label="h" />
            </Adw.SpinRow>
        </Adw.PreferencesGroup>
    );
};
