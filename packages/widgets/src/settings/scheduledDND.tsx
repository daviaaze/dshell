import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {bus} from '@shade/services/bus';
import DndService from '@shade/services/notifications/dnd';
import {computed, createState, onCleanup} from 'gnim';
import {isHourInDndWindow} from './dndSchedule';

export default () => {
    const dnd = DndService.get_default();
    const [enabled, setEnabled] = createState(false);
    const [startHour, setStartHour] = createState(22);
    const [endHour, setEndHour] = createState(7);
    let timeoutId: number | null = null;
    // Do Not Disturb state found when the schedule was switched on.
    let priorDnd: boolean | null = null;
    let inWindow = false;
    // Last value written by the schedule; null while it has not changed anything.
    let lastSet: boolean | null = null;

    // Writes only when the window is entered or left, so a manual toggle
    // lasts until the next boundary.
    const syncDnd = () => {
        const next = isHourInDndWindow(new Date().getHours(), startHour(), endHour());
        if (next === inWindow) return;
        inWindow = next;
        lastSet = next;
        bus.emit('system:dnd:set', next);
    };

    const startSchedule = () => {
        priorDnd = dnd.dnd;
        inWindow = false;
        lastSet = null;
        syncDnd();
        timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            syncDnd();
            return GLib.SOURCE_CONTINUE;
        });
    };

    const stopSchedule = () => {
        if (timeoutId === null) return;
        GLib.source_remove(timeoutId);
        timeoutId = null;
        // Undo the schedule's own write; a later manual change is kept.
        if (priorDnd !== null && lastSet !== null && dnd.dnd === lastSet) {
            bus.emit('system:dnd:set', priorDnd);
        }
        priorDnd = null;
        lastSet = null;
        inWindow = false;
    };

    onCleanup(stopSchedule);

    return (
        <Adw.PreferencesGroup
            title="Agenda de não perturbe"
            description="Agenda local, ativa somente enquanto esta página existir; não é persistida. Ao desativar a agenda ou fechar a página, o estado anterior do não perturbe é restaurado."
        >
            <Adw.SwitchRow
                title="Ativar agenda"
                subtitle="Uma alteração manual do não perturbe vale até o próximo início ou término."
                active={enabled}
                onNotifyActive={(self) => {
                    if (self.active === enabled()) return;
                    setEnabled(self.active);
                    if (self.active) startSchedule();
                    else stopSchedule();
                }}
            />

            <Adw.SpinRow
                title="Começa às"
                subtitle="Hora local em formato de 24 horas."
                onNotifyValue={(self) => {
                    setStartHour(Math.round(self.get_value()));
                    if (enabled()) syncDnd();
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
                subtitle={computed(() => {
                    if (startHour() === endHour()) {
                        return 'Igual ao início: a agenda não ativa o não perturbe.';
                    }
                    return startHour() < endHour()
                        ? 'Hora local em formato de 24 horas, no mesmo dia.'
                        : 'Hora local em formato de 24 horas, no dia seguinte.';
                })}
                onNotifyValue={(self) => {
                    setEndHour(Math.round(self.get_value()));
                    if (enabled()) syncDnd();
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
