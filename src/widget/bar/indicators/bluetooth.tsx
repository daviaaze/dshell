import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"
import { toArray } from "#/lib/gjsUtils"

export default () => {
  const [iconName, setIconName] = createState("bluetooth-disconnected-symbolic")
  const [visible, setVisible] = createState(false)
  const [tooltip, setTooltip] = createState("")

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const bt = Bluetooth.get_default()
      const update = () => {
        const powered = bt.isPowered
        setVisible(powered)
        if (!powered) {
          setIconName("bluetooth-disconnected-symbolic")
          setTooltip("Bluetooth")
          return
        }
        const connected = bt.is_connected
        setIconName(connected ? "bluetooth-active-symbolic" : "bluetooth-disconnected-symbolic")
        const list = bt.devices
        if (list) {
          const names = toArray<any>(list)
            .filter((d: any) => d.connected)
            .map((d: any) => d.name)
          setTooltip(names.length > 0 ? names.join(", ") : "Bluetooth")
        }
      }
      update()
      bt.connect("notify::is-powered", update)
      bt.connect("notify::is-connected", update)
      bt.connect("notify::devices", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      iconName={iconName}
      visible={visible}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}
