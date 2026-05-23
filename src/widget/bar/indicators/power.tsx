import Gtk from "gi://Gtk?version=4.0"
import PowerProf from "gi://AstalPowerProfiles"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"

export default () => {
  const [visible, setVisible] = createState(false)
  const [iconName, setIconName] = createState("")
  const [tooltip, setTooltip] = createState("")

  onMount(() => {
    // Defer D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const p = PowerProf.get_default()
      const update = () => {
        setVisible(p.activeProfile !== "balanced")
        setIconName(p.iconName ?? "")
        setTooltip(p.activeProfile ?? "")
      }
      update()
      p.connect("notify::activeProfile", update)
      p.connect("notify::iconName", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName={iconName}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}
