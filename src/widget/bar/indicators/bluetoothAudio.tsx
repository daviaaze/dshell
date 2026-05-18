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

function batteryColor(level: number): string {
  if (level < 20) return "color: #e03e3e;"
  if (level < 50) return "color: #f5c211;"
  return ""
}

export default () => {
  const bluetooth = Bluetooth.get_default()

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
          battery: bat * 100,
        }
      }
    }
    return null
  })

  return (
    <Gtk.Box
      visible={deviceInfo.as(d => d !== null)}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      spacing={4}>
      <Gtk.Image
        iconName="audio-headphones-symbolic"
        pixelSize={18}
        css={deviceInfo.as(d =>
          d ? batteryColor(d.battery) : "")} />
      <Gtk.Image
        iconName={deviceInfo.as(d =>
          d ? batteryIcon(d.battery) : "")}
        tooltipMarkup={deviceInfo.as(d =>
          d ? `${d.name}: ${d.battery.toFixed(0)}%` : "")}
        pixelSize={16} />
    </Gtk.Box>
  )
}
