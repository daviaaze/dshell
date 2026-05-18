import Bluetooth from "gi://AstalBluetooth"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { toArray } from "#/lib/gjsUtils"

function batteryIcon(level: number): string {
  if (level < 0) return ""
  if (level <= 10) return "battery-empty-symbolic"
  if (level <= 30) return "battery-quarter-symbolic"
  if (level <= 55) return "battery-half-symbolic"
  if (level <= 80) return "battery-three-quarters-symbolic"
  return "battery-full-symbolic"
}

export default () => {
  const bluetooth = Bluetooth.get_default()
  const isPowered = createBinding(bluetooth, "isPowered")

  const deviceInfo = createComputed([
    createBinding(bluetooth, "is-connected"),
  ], (_connected) => {
    const devices = toArray<any>(bluetooth.devices)
    for (const d of devices) {
      if (!d.connected) continue
      const bat = d.battery_percentage
      if (bat >= 0) {
        return {
          name: d.name || "Device",
          icon: d.icon || "bluetooth-symbolic",
          battery: bat,
        }
      }
    }
    return null
  })

  return (
    <Gtk.Box
      visible={deviceInfo.as(d => d !== null)}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      spacing={2}>
      <Gtk.Image
        iconName={deviceInfo.as(d => d?.icon || "bluetooth-symbolic")}
        pixelSize={18} />
      <Gtk.Image
        iconName={deviceInfo.as(d =>
          d ? batteryIcon(d.battery) : "")}
        tooltipMarkup={deviceInfo.as(d =>
          d ? `${d.name}: ${d.battery.toFixed(0)}%` : "")}
        pixelSize={16} />
    </Gtk.Box>
  )
}
