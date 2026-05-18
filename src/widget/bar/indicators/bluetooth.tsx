import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { toArray } from "#/lib/gjsUtils"

export default () => {
  const bluetooth = Bluetooth.get_default()

  const isConnected = createBinding(bluetooth, "is-connected")
  const isPowered = createBinding(bluetooth, "isPowered")

  const batteryLabel = createComputed([
    createBinding(bluetooth, "is-connected"),
  ], (_connected) => {
    const devices = toArray<any>(bluetooth.devices)
    const connected = devices.filter(d => d.connected)
    for (const device of connected) {
      const bat = device.battery_percentage
      if (bat >= 0) return `${bat.toFixed(0)}%`
    }
    return ""
  })

  const tooltip = createComputed([
    createBinding(bluetooth, "is-connected")
  ], (_connected) => {
    const devices = bluetooth.devices
    if (!devices) return ""
    const arr = Array.isArray(devices) ? devices : Array.from(devices)
    const connected = arr.filter((d: any) => d.connected).map((d: any) => d.name)
    return connected.length > 0 ? connected.join(", ") : "Bluetooth"
  })

  return (
    <Gtk.Box spacing={2}>
      <Gtk.Image
        iconName={isConnected.as(c => c
          ? "bluetooth-active-symbolic"
          : "bluetooth-disconnected-symbolic")}
        visible={isPowered}
        tooltipMarkup={tooltip}
        pixelSize={18} />
      <Gtk.Label
        cssClasses={["bluetooth-battery"]}
        visible={batteryLabel.as(l => l !== "")}
        label={batteryLabel}
      />
    </Gtk.Box>
  )
}
