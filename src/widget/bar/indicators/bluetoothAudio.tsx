import Bluetooth from "gi://AstalBluetooth"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import { useSettings } from "#/lib/settings"

function batteryColor(level: number): string {
  if (level < 20) return "color: #e03e3e;"
  if (level < 50) return "color: #f5c211;"
  return ""
}

export default () => {
  const bluetooth = Bluetooth.get_default()
  const { bar } = useSettings()

  const isConnected = createBinding(bluetooth, "is-connected")
  const devices = createBinding(bluetooth, "devices")

  const deviceInfo = createComputed(() => {
    // Track both is-connected and devices list so we recompute
    // when either changes — critical for late-arriving battery info
    const _connected = isConnected()
    const list = devices()
    if (!_connected || !list) return null
    const arr = toArray<any>(list)
    for (const d of arr) {
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

  const visible = createComputed(() =>
    deviceInfo() !== null && bar.showBluetoothBattery()
  )

  return (
    <Gtk.Button
      visible={visible}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      tooltipMarkup={deviceInfo.as(d =>
        d ? `${d.name}: ${d.battery.toFixed(0)}%` : "")}
    >
      <Gtk.Image
        iconName="audio-headphones-symbolic"
        pixelSize={18}
        css={deviceInfo.as(d =>
          d ? batteryColor(d.battery) : "")} />
    </Gtk.Button>
  )
}
