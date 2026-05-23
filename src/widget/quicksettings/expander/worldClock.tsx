import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"
import { createState, For, onCleanup } from "gnim"
import { useSettings } from "#/lib/settings"
import { fmtOffset, cityName } from "#/lib/time"

export const WorldClock = () => {
  const { general } = useSettings()
  const [time, setTime] = createState(GLib.DateTime.new_now_local())

  const worldClockTimeout = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    1000,
    () => {
      setTime(GLib.DateTime.new_now_local())
      return GLib.SOURCE_CONTINUE
    },
  )
  onCleanup(() => GLib.source_remove(worldClockTimeout))

  const localTz = GLib.TimeZone.new_local()

  return (
    <Gtk.Box
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["card", "p-12"]}
    >
      <Gtk.Label
        cssClasses={["title-3"]}
        label="World Clock"
        halign={Gtk.Align.CENTER}
      />
      <For each={general.timezones}>
        {(tzId: string) => {
          const tz = GLib.TimeZone.new(tzId)
          const tzTime = time.as((t) => t.to_timezone(tz))
          return (
            <Gtk.Box spacing={8} marginStart={8}>
              <Gtk.Label
                hexpand
                halign={Gtk.Align.START}
                cssClasses={["heading", "title-4"]}
                label={cityName(tzId)}
              />
              <Gtk.Label
                halign={Gtk.Align.END}
                cssClasses={["numeric", "title-4"]}
                label={tzTime.as((t) => t.format("%H:%M") ?? "--:--")}
              />
              <Gtk.Label
                halign={Gtk.Align.END}
                cssClasses={["caption", "dim-label"]}
                label={fmtOffset(localTz, tz)}
              />
            </Gtk.Box>
          )
        }}
      </For>
    </Gtk.Box>
  )
}
