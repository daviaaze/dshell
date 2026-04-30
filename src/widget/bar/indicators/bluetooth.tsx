import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () => {
  const bluetooth = Bluetooth.get_default()

  const isConnected = createBinding(bluetooth, "devices")
    .as(devices => {
      if (!devices) return false
      const arr = Array.isArray(devices) ? devices : Array.from(devices)
      return arr.some((d: any) => d.connected)
    })

  const tooltip = createBinding(bluetooth, "devices")
    .as(devices => {
      if (!devices) return ""
      const arr = Array.isArray(devices) ? devices : Array.from(devices)
      const connected = arr.filter((d: any) => d.connected).map((d: any) => d.name)
      return connected.length > 0 ? connected.join(", ") : "Bluetooth"
    })

  return <Gtk.Image
    iconName={isConnected.as(c => c
      ? "bluetooth-active-symbolic"
      : "bluetooth-symbolic")}
    visible={createBinding(bluetooth, "adapter")
      .as(adapter => adapter && adapter.powered)}
    tooltipMarkup={tooltip}
    pixelSize={18} />
}
