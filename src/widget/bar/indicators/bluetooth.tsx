import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { toArray } from "#/lib/gjsUtils"

export default () => {
  const bluetooth = Bluetooth.get_default()

  const isConnected = createBinding(bluetooth, "is-connected")
  const devices = createBinding(bluetooth, "devices")

  const tooltip = createComputed(
    [isConnected, devices],
    (_connected, _devices) => {
      // Track both is-connected and devices list so we recompute
      // when either changes — critical for late-arriving device info
      const list = bluetooth.devices
      if (!list) return ""
      const arr = toArray(list)
      const connected = arr
        .filter((d: any) => d.connected)
        .map((d: any) => d.name)
      return connected.length > 0 ? connected.join(", ") : "Bluetooth"
    },
  )

  return (
    <Gtk.Image
      iconName={isConnected.as((c) =>
        c ? "bluetooth-active-symbolic" : "bluetooth-disconnected-symbolic",
      )}
      visible={createBinding(bluetooth, "isPowered")}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}
