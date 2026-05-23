import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"

export default () => {
  const [iconName, setIconName] = createState("network-no-route-symbolic")
  const [visible, setVisible] = createState(false)

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const n = Network.get_default()
      const update = () => {
        const primary = n.primary
        setVisible(primary !== Network.Primary.UNKNOWN)
        if (primary === Network.Primary.WIFI) {
          setIconName(n.wifi?.iconName || "network-wireless-offline-symbolic")
        } else if (primary === Network.Primary.WIRED) {
          setIconName(n.wired?.iconName || "network-wired-offline-symbolic")
        } else {
          setIconName("network-no-route-symbolic")
        }
      }
      update()
      n.connect("notify::primary", update)
      n.connect("notify::wifi", update)
      n.connect("notify::wired", update)
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      iconName={iconName}
      visible={visible}
      pixelSize={18}
    />
  )
}
