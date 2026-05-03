import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"

function updateCalendar(calendar: Gtk.Calendar) {
  const now = GLib.DateTime.new_now_local()
  calendar.year = now.get_year()
  calendar.month = now.get_month() - 1
  calendar.day = now.get_day_of_month()
}

export const Calendar = () =>
  <Gtk.Calendar
    cssClasses={["card"]}
    $={self => updateCalendar(self)}
  />

export const CalendarIcon = () =>
  <Gtk.Box
    spacing={4}
    marginStart={8}
    marginEnd={8}
    hexpand
    halign={Gtk.Align.CENTER}>
    <Gtk.Image
      iconName={"x-office-calendar-symbolic"}
      pixelSize={20}
    />
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Label
        label={GLib.DateTime
          .new_now_local()
          .format("%A") ?? ""}
      />
      <Gtk.Label
        label={GLib.DateTime
          .new_now_local()
          .format("%x") ?? ""}
      />
    </Gtk.Box>
  </Gtk.Box>
