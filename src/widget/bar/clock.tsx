import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import { Accessor, createState, For, onCleanup } from "gnim"
import { useSettings } from "#/lib/settings"

function updateCalendar(calendar: Gtk.Calendar) {
  const now = GLib.DateTime.new_now_local()
  calendar.year = now.get_year()
  calendar.month = now.get_month() - 1
  calendar.day = now.get_day_of_month()
}

function fmtOffset(local: GLib.TimeZone, remote: GLib.TimeZone): string {
  const now = GLib.DateTime.new_now(local)
  const remoteNow = now.to_timezone(remote)
  const localOffset = now.get_utc_offset() / GLib.TIME_SPAN_HOUR
  const remoteOffset = remoteNow.get_utc_offset() / GLib.TIME_SPAN_HOUR
  const diff = remoteOffset - localOffset
  if (diff === 0) return "same time"
  const sign = diff > 0 ? "+" : ""
  return `${sign}${diff.toFixed(0)}h`
}

function cityName(tzId: string): string {
  return tzId.split("/").pop()?.replaceAll("_", " ") ?? tzId
}

export default ({ vertical }: { vertical: Accessor<boolean> }) => {
  const { general } = useSettings()
  const [time, setTime] = createState(new GLib.DateTime)
  const clockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    setTime(GLib.DateTime.new_now_local())
    return GLib.SOURCE_CONTINUE
  })
  onCleanup(() => GLib.source_remove(clockTimeout))

  const day = time.as(t => t.get_day_of_month().toString())
  const month = time.as(t => t.format("%b")!)
  const hour = time.as(t => t.format("%H")!)
  const minute = time.as(t => t.format("%M")!)

  const localTz = GLib.TimeZone.new_local()
  let calendarRef: Gtk.Calendar | null = null

  return <Gtk.MenuButton
    direction={vertical.as(v => v ?
      Gtk.ArrowType.RIGHT :
      Gtk.ArrowType.UP)}
    cursor={Gdk.Cursor.new_from_name("pointer", null)}
    popover={<Gtk.Popover
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}
      cssClasses={[]}
      hasArrow={false}
      $={self => self.connect("show", () => {
        if (calendarRef) updateCalendar(calendarRef)
      })}>
      <Gtk.Box
        spacing={12}
        orientation={Gtk.Orientation.VERTICAL}
        marginTop={12}
        marginBottom={12}
        marginStart={12}
        marginEnd={12}>
        <Gtk.Calendar
          $={self => {
            calendarRef = self
            updateCalendar(self)
          }}
        />
        <Gtk.Separator />
        <Gtk.Box
          spacing={8}
          orientation={Gtk.Orientation.VERTICAL}>
          <Gtk.Label
            cssClasses={["title-3"]}
            label="World Clock"
            halign={Gtk.Align.CENTER}
          />
          <For each={general.timezones}>
            {(tzId: string) => {
              const tz = GLib.TimeZone.new(tzId)
              const tzTime = time.as(t => t.to_timezone(tz))
              return <Gtk.Box spacing={8}>
                <Gtk.Label
                  hexpand
                  halign={Gtk.Align.START}
                  cssClasses={["heading"]}
                  label={cityName(tzId)}
                />
                <Gtk.Label
                  halign={Gtk.Align.END}
                  cssClasses={["numeric"]}
                  label={tzTime.as(t => t.format("%H:%M") ?? "--:--")}
                />
                <Gtk.Label
                  halign={Gtk.Align.END}
                  cssClasses={["caption"]}
                  label={fmtOffset(localTz, tz)}
                />
              </Gtk.Box>
            }}
          </For>
        </Gtk.Box>
      </Gtk.Box>
    </Gtk.Popover> as Gtk.Popover}>
    <Gtk.Box
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      orientation={vertical.as(v => v ?
        Gtk.Orientation.VERTICAL :
        Gtk.Orientation.HORIZONTAL)}
      spacing={vertical.as(v => v ? 0 : 4)}>
      <Gtk.Box
        orientation={vertical.as(v => v ?
          Gtk.Orientation.VERTICAL :
          Gtk.Orientation.HORIZONTAL)}
        spacing={vertical.as(v => v ? 0 : 4)}>
        <Gtk.Label
          label={hour}
          cssClasses={["title-1", "numeric"]} />
        <Gtk.Label
          label={minute}
          cssClasses={["title-1", "numeric"]} />
      </Gtk.Box>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}>
        <Gtk.Label
          cssClasses={["caption-heading"]}
          label={day} />
        <Gtk.Label
          cssClasses={["caption"]}
          label={month} />
      </Gtk.Box>
    </Gtk.Box>
  </Gtk.MenuButton >
}
