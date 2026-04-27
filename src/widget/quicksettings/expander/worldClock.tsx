import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"
import { createBinding, createState, For } from "gnim"
import { useSettings } from "#/lib/settings"

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

export const WorldClock = () => {
  const { general } = useSettings()
  const [time, setTime] = createState(GLib.DateTime.new_now_local())

  setInterval(() => {
    setTime(GLib.DateTime.new_now_local())
  }, 1000)

  const localTz = GLib.TimeZone.new_local()

  return <Gtk.Box
    spacing={8}
    orientation={Gtk.Orientation.VERTICAL}
    cssClasses={["card"]}
  >
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
}
