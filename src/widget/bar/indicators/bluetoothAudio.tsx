import Bluetooth from "gi://AstalBluetooth"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import { useSettings } from "#/lib/settings"

function batteryColor(level: number): string {
  if (level < 20) return "color: #e03e3e;"
  if (level < 50) return "color: #f5c211;"
  return ""
}

type DeviceInfo = { name: string; battery: number } | null

function getDeviceInfo(bt: Bluetooth.Bluetooth): DeviceInfo {
  if (!bt.is_connected) return null
  const list = bt.devices
  if (!list) return null
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
}

export default () => {
  const [deviceInfo, setDeviceInfo] = createState<DeviceInfo>(null)
  const [visible, setVisible] = createState(false)
  const { bar } = useSettings()
  const showBattery = bar.showBluetoothBattery

  onMount(() => {
    // Defer Bluetooth D-Bus proxy to avoid blocking the main loop
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const bt = Bluetooth.get_default()
      const update = () => {
        const info = getDeviceInfo(bt)
        setDeviceInfo(info)
        setVisible(info !== null && showBattery())
      }
      update()
      bt.connect("notify::is-connected", update)
      bt.connect("notify::devices", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Button
      visible={visible}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      tooltipMarkup={deviceInfo.as((d) =>
        d ? `${d.name}: ${d.battery.toFixed(0)}%` : "",
      )}
    >
      <Gtk.Image
        iconName="audio-headphones-symbolic"
        pixelSize={18}
        css={deviceInfo.as((d) => (d ? batteryColor(d.battery) : ""))}
      />
    </Gtk.Button>
  )
}
