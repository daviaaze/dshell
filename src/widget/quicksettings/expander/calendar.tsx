import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {IconInfoRow} from '#/widget/common/iconInfoRow';

function updateCalendar(calendar: Gtk.Calendar) {
    const now = GLib.DateTime.new_now_local();
    calendar.year = now.get_year();
    calendar.month = now.get_month() - 1;
    calendar.day = now.get_day_of_month();
}

export const Calendar = () => (
    <Gtk.Calendar
        cssClasses={['card', 'p-12']}
        $={self => updateCalendar(self)}
    />
);

export const CalendarIcon = () => {
    const now = GLib.DateTime.new_now_local();
    return (
        <IconInfoRow
            icon="x-office-calendar-symbolic"
            primary={now.format('%A') ?? ''}
            secondary={now.format('%x') ?? ''}
        />
    );
};
