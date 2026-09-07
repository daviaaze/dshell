import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import { createState, onCleanup } from 'gnim';
import { bus } from '@shade/services/bus';

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
        <Adw.PreferencesGroup title="Scheduled DND" description="Automatically enable Do Not Disturb">
            <Adw.SwitchRow
                title="Enable Schedule"
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
                title="Start Hour"
                subtitle="Hour to enable DND (24-hour format)"
                adjustment={new Gtk.Adjustment({
                    value: startHour(),
                    lower: 0,
                    upper: 23,
                    stepIncrement: 1,
                })}
                onNotifyValue={(self) => {
                    setStartHour(self.get_value());
                    if (enabled()) checkAndSetDND();
                }}
            />

            <Adw.SpinRow
                title="End Hour"
                subtitle="Hour to disable DND (24-hour format)"
                adjustment={new Gtk.Adjustment({
                    value: endHour(),
                    lower: 0,
                    upper: 23,
                    stepIncrement: 1,
                })}
                onNotifyValue={(self) => {
                    setEndHour(self.get_value());
                    if (enabled()) checkAndSetDND();
                }}
            />
        </Adw.PreferencesGroup>
    );
};
