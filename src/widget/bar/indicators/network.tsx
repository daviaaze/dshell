import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"

export default () => {
  const network = Network.get_default()

  const icon = createComputed([
    createBinding(network, "primary"),
    createBinding(network, "wifi"),
    createBinding(network, "wired")],
    (primary, wifi, wired) => {
      if (primary === Network.Primary.WIFI) {
        return wifi?.iconName || "network-wireless-offline-symbolic"
      }
      if (primary === Network.Primary.WIRED) {
        return wired?.iconName || "network-wired-offline-symbolic"
      }
      return "network-no-route-symbolic"
    })

  return <Gtk.Image
    iconName={icon}
    visible={createBinding(network, "primary")
      .as(p => p !== Network.Primary.UNKNOWN)}
    pixelSize={18} />
}
