import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createState, onCleanup } from "gnim"
import { useSettings } from "#/lib/settings"

try {
  imports.gi.versions.AstalCava = "0.1"
} catch { /* ignore */ }

const AstalCava = (() => {
  try {
    return imports.gi.AstalCava
  } catch {
    return null
  }
})()

export default () => {
  const settings = useSettings().general
  const enabled = createBinding(settings, "cavaEnabled")

  if (!AstalCava) {
    return <Gtk.Box visible={false} />
  }

  return <Gtk.Box
    visible={enabled}
    orientation={Gtk.Orientation.HORIZONTAL}
    spacing={2}
    halign={Gtk.Align.CENTER}
    valign={Gtk.Align.END}
    marginTop={8}
    marginBottom={8}
    $={self => {
      const cava = new AstalCava.Cava()
      cava.bars = settings.get_int("cava-bars") || 16
      cava.framerate = settings.get_int("cava-framerate") || 60
      cava.active = true

      const bars: Gtk.LevelBar[] = []
      const barCount = cava.bars

      for (let i = 0; i < barCount; i++) {
        const bar = new Gtk.LevelBar()
        bar.set_min_value(0)
        bar.set_max_value(1)
        bar.set_value(0)
        bar.set_orientation(Gtk.Orientation.VERTICAL)
        bar.set_inverted(true)
        bar.set_size_request(6, 40)
        bar.add_css_class("osd")
        self.append(bar)
        bars.push(bar)
      }

      const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 / cava.framerate, () => {
        if (!self.get_parent()) return GLib.SOURCE_REMOVE
        const values = cava.get_values()
        if (!values || !values.length) return GLib.SOURCE_CONTINUE
        for (let i = 0; i < Math.min(bars.length, values.length); i++) {
          bars[i].set_value(Math.min(1, Math.max(0, values[i])))
        }
        return GLib.SOURCE_CONTINUE
      })

      self.connect("destroy", () => {
        GLib.source_remove(timer)
        cava.active = false
      })
    }}
  />
}
