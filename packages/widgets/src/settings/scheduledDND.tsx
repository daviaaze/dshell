import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import {createState, onCleanup} from 'gnim';

export default () => {
    const [enabled, setEnabled] = createState(false);
    const [startHour, setStartHour] = createState(22);
    const [endHour, setEndHour] = createState(7);
    let timeoutId: number | null = null;

    const checkAndSetDND = () => {
        const now = new Date();
        const hour = now.getHours();
        const shouldEnable = hour >= startHour() || hour < endHour();
        bus.emit('system:dnd:set', shouldEnable);
    };

    const startTimer = () => {
        if (timeoutId !== null) {
            GLib.source_remove(timeoutId);
        }
        timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            checkAndSetDND();
            return GLib.SOURCE_CONTINUE;
        });
    };

    const stopTimer = () => {
        if (timeoutId !== null) {
            GLib.source_remove(timeoutId);
            timeoutId = null;
        }
    };

    onCleanup(() => {
        stopTimer();
    });

    if (enabled()) {
        checkAndSetDND();
        startTimer();
    }

    return (
        <Adw.PreferencesGroup
            title="Agenda de não perturbe"
            description="Agenda local, ativa somente enquanto esta página existir; não é persistida."
        >
            <Adw.SwitchRow
                title="Ativar agenda"
                active={enabled()}
                onNotifyActive={(self) => {
                    setEnabled(self.active);
                    if (self.active) {
                        checkAndSetDND();
                        startTimer();
                    } else {
                        stopTimer();
                    }
                }}
            />

            <Adw.SpinRow
                title="Começa às"
                subtitle="Hora local em formato de 24 horas."
                onNotifyValue={(self) => {
                    setStartHour(self.get_value());
                    if (enabled()) checkAndSetDND();
                }}
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        value: startHour(),
                        lower: 0,
                        upper: 23,
                        stepIncrement: 1,
                    });
                    self.set_value(startHour());
                }}
            >
                <Gtk.Label slot="suffix" label="h" />
            </Adw.SpinRow>

            <Adw.SpinRow
                title="Termina às"
                subtitle="Hora local em formato de 24 horas."
                onNotifyValue={(self) => {
                    setEndHour(self.get_value());
                    if (enabled()) checkAndSetDND();
                }}
                ref={(self) => {
                    self.adjustment = new Gtk.Adjustment({
                        value: endHour(),
                        lower: 0,
                        upper: 23,
                        stepIncrement: 1,
                    });
                    self.set_value(endHour());
                }}
            >
                <Gtk.Label slot="suffix" label="h" />
            </Adw.SpinRow>
        </Adw.PreferencesGroup>
    );
};
