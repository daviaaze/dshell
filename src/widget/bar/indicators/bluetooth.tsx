import Bluetooth from "gi://AstalBluetooth"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount, onCleanup } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import { connectFor, cleanupNode } from "#/lib/connectFor"

export default () => {
  const [iconName, setIconName] = createState("bluetooth-disconnected-symbolic")
  const [visible, setVisible] = createState(false)
  const [tooltip, setTooltip] = createState("")

  onMount(() => {
    const _hn = {}
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
      connectFor(_hn, bt, "notify::is-powered", update)
      connectFor(_hn, bt, "notify::is-connected", update)
      connectFor(_hn, bt, "notify::devices", update)
      return GLib.SOURCE_REMOVE
    })
    onCleanup(() => cleanupNode(_hn))
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