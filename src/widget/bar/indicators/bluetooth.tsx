import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"

export default () => {
  const bluetooth = Bluetooth.get_default()

  const isConnected = createBinding(bluetooth, "is-connected")

  const tooltip = createComputed([
    createBinding(bluetooth, "is-connected")
  ], (_connected) => {
    const devices = bluetooth.devices
    if (!devices) return ""
    const arr = Array.isArray(devices) ? devices : Array.from(devices)
    const connected = arr.filter((d: any) => d.connected).map((d: any) => d.name)
    return connected.length > 0 ? connected.join(", ") : "Bluetooth"
  })

  return <Gtk.Image
    iconName={isConnected.as(c => c
      ? "bluetooth-active-symbolic"
      : "bluetooth-disconnected-symbolic")}
    visible={createBinding(bluetooth, "isPowered")}
    tooltipMarkup={tooltip}
    pixelSize={18} />
}
