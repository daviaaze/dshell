import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"

export default () => {
  const network = Network.get_default()
  const wifi = network.wifi
  const wired = network.wired

  const icon = createComputed([
    createBinding(network, "primary"),
    wifi ? createBinding(wifi, "iconName") : () => "network-wireless-offline-symbolic",
    wired ? createBinding(wired, "iconName") : () => "network-wired-offline-symbolic",
  ], (primary, wifiIcon, wiredIcon) => {
    if (primary === Network.Primary.WIFI) {
      return wifiIcon || "network-wireless-offline-symbolic"
    }
    if (primary === Network.Primary.WIRED) {
      return wiredIcon || "network-wired-offline-symbolic"
    }
    return "network-no-route-symbolic"
  })

  return <Gtk.Image
    iconName={icon}
    visible={createBinding(network, "primary")
      .as(p => p !== Network.Primary.UNKNOWN)}
    pixelSize={18} />
}
