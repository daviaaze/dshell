import Batery from "gi://AstalBattery"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"

export default () => {
  const [visible, setVisible] = createState(false)
  const [iconName, setIconName] = createState("")
  const [tooltip, setTooltip] = createState("")
  const [cssClasses, setCssClasses] = createState<string[]>([])

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const b = Batery.get_default()
      const update = () => {
        setVisible(b.is_present)
        setIconName(b.batteryIconName ?? "")
        setTooltip(`${(b.percentage * 100).toFixed(0)}%`)
        const level = b.warning_level
        if (level === Batery.WarningLevel.CRITICIAL || level === Batery.WarningLevel.ACTION)
          setCssClasses(["error"])
        else if (level === Batery.WarningLevel.LOW || level === Batery.WarningLevel.DISCHARGING)
          setCssClasses(["warning"])
        else
          setCssClasses([])
      }
      update()
      b.connect("notify::is-present", update)
      b.connect("notify::battery-icon-name", update)
      b.connect("notify::percentage", update)
      b.connect("notify::warning-level", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName={iconName}
      tooltipMarkup={tooltip}
      cssClasses={cssClasses}
      pixelSize={18}
    />
  )
}
