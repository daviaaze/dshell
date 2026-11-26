import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Clock from '@shade/services/time/clock';
import {onCleanup} from 'gnim';

export const Calendar = () => {
    const wallTime = Clock.get_default().wallTime;
    let shownDate = '';
    const showToday = (calendar: Gtk.Calendar) => {
        const now = GLib.DateTime.new_now_local();
        if (!now) return;
        shownDate = now.format('%F') ?? '';
        calendar.select_day(now);
    };

    return (
        <Gtk.Calendar
            cssClasses={['card']}
            onMap={showToday}
            ref={(self) => {
                showToday(self);
                // Follow the date across midnight without undoing month navigation
                // while the page stays open during the day.
                onCleanup(
                    wallTime.subscribe(() => {
                        if (wallTime.peek().format('%F') !== shownDate) showToday(self);
                    })
                );
            }}
        />
    );
};
