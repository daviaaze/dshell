import Batery from "gi://AstalBattery"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () => {
  const battery = Batery.get_default()

  return (
    <Gtk.Image
      visible={createBinding(battery, "is_present")}
      iconName={createBinding(battery, "batteryIconName")}
      tooltipMarkup={createBinding(battery, "percentage").as(
        (p) => (p * 100).toFixed(0).toString() + "%",
      )}
      cssClasses={createBinding(battery, "warning_level").as((level) => {
        if (
          level === Batery.WarningLevel.CRITICIAL ||
          level === Batery.WarningLevel.ACTION
        )
          return ["error"]
        if (
          level === Batery.WarningLevel.LOW ||
          level === Batery.WarningLevel.DISCHARGING
        )
          return ["warning"]
        return []
      })}
      pixelSize={18}
    />
  )
}
