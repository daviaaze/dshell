import Bluetooth from "gi://AstalBluetooth"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { createComputed, createState, onCleanup, onMount } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import { useSettings } from "#/lib/settings"
import { getDeviceBatteryPercentage } from "#/lib/bluetoothBattery"

const ICON_MAP: Record<string, string> = {
  "audio-headset": "audio-headset-symbolic",
  "audio-headphones": "audio-headphones-symbolic",
  "audio-card": "audio-speakers-symbolic",
  "audio-speaker": "audio-speakers-symbolic",
  "input-keyboard": "input-keyboard-symbolic",
  "input-mouse": "input-mouse-symbolic",
  "input-tablet": "input-tablet-symbolic",
  "input-gaming": "input-gaming-symbolic",
  phone: "phone-symbolic",
  computer: "computer-symbolic",
  laptop: "computer-symbolic",
  "network-wireless": "network-wireless-symbolic",
  printer: "printer-symbolic",
  "camera-video": "camera-video-symbolic",
  "camera-photo": "camera-photo-symbolic",
  "multimedia-player": "multimedia-player-symbolic",
  scanner: "scanner-symbolic",
  tv: "tv-symbolic",
}

function deviceIcon(icon: string): string {
  return ICON_MAP[icon] || "bluetooth-symbolic"
}

function applyColorCss(widget: Gtk.Widget, level: number | null) {
  let css: string
  if (level === null) return
  if (level < 20) css = "* { color: #e03e3e; }"
  else if (level < 50) css = "* { color: #f5c211; }"
  else return

  const provider = new Gtk.CssProvider()
  provider.load_from_string(css)
  widget.get_style_context().add_provider(
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_USER,
  )
}

export default () => {
  const bluetooth = Bluetooth.get_default()
  const { bar } = useSettings()

  const [deviceInfo, setDeviceInfo] = createState<
    { name: string; icon: string; battery: number | null }[]
  >([])

  // Container box created once via $ callback to avoid
  // gtk_button_set_child assertion when Gnim re-renders <For> children.
  // Children are managed imperatively in refresh() instead.
  let iconBox: Gtk.Box | null = null

  function updateIcons(
    devices: { name: string; icon: string; battery: number | null }[],
  ) {
    const box = iconBox
    if (!box) return

    // Remove old icon widgets
    let child = box.get_first_child()
    while (child) {
      const next = child.get_next_sibling()
      box.remove(child)
      child = next
    }

    // Add icon for each connected device
    for (const d of devices) {
      const img = new Gtk.Image({
        iconName: d.icon,
        pixelSize: 18,
      })
      applyColorCss(img, d.battery)
      box.append(img)
    }
  }

  onMount(() => {
    const batterySignals = new Map<string, number>()

    function refresh() {
      if (!bluetooth.is_connected) {
        setDeviceInfo([])
        return
      }
      const list = bluetooth.devices
      if (!list) {
        setDeviceInfo([])
        return
      }
      const arr = toArray<any>(list)

      // Disconnect battery signals for devices no longer connected
      for (const [addr, id] of batterySignals) {
        if (!arr.some((d) => d.address === addr && d.connected)) {
          const dev = arr.find((d) => d.address === addr)
          if (dev) dev.disconnect(id)
          batterySignals.delete(addr)
        }
      }

      // Connect battery signals for newly connected devices
      for (const d of arr) {
        if (d.connected && !batterySignals.has(d.address)) {
          const id = d.connect("notify::battery-percentage", refresh)
          batterySignals.set(d.address, id)
        }
      }

      const devices = arr
        .filter((d) => d.connected)
        .map((d) => ({
          name: d.name || "Device",
          icon: deviceIcon(d.icon || ""),
          battery: getDeviceBatteryPercentage(d),
        }))

      setDeviceInfo(devices)
      updateIcons(devices)
    }

    bluetooth.connect("notify::is-connected", refresh)
    bluetooth.connect("notify::devices", refresh)
    refresh()
  })

  const visible = createComputed(
    () => deviceInfo().length > 0 && bar.showBluetoothBattery(),
  )

  const tooltipText = deviceInfo.as((arr) =>
    arr.length > 0
      ? arr
          .map((d) =>
            d.battery !== null
              ? `${d.name}: ${d.battery.toFixed(0)}%`
              : d.name,
          )
          .join("\n")
      : "",
  )

  return (
    <Gtk.Button
      visible={visible}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      tooltipMarkup={tooltipText}
      $={(self) => {
        iconBox = new Gtk.Box({ spacing: 4 })
        self.set_child(iconBox)
        onCleanup(() => {
          iconBox = null
        })
      }}
    />
  )
}
