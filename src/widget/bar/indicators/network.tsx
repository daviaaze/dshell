import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"

export default () => {
  const network = Network.get_default()
  const wifi = createBinding(network, "wifi")
  const wired = createBinding(network, "wired")

  const icon = createComputed(
    [createBinding(network, "primary"), wifi, wired],
    (primary, wifiDevice, wiredDevice) => {
      if (primary === Network.Primary.WIFI) {
        return wifiDevice?.iconName || "network-wireless-offline-symbolic"
      }
      if (primary === Network.Primary.WIRED) {
        return wiredDevice?.iconName || "network-wired-offline-symbolic"
      }
      return "network-no-route-symbolic"
    },
  )

  return (
    <Gtk.Image
      iconName={icon}
      visible={createBinding(network, "primary").as(
        (p) => p !== Network.Primary.UNKNOWN,
      )}
      pixelSize={18}
    />
  )
}
