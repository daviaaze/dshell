import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createState, onMount } from "gnim"
import { wifiIconName } from "#/widget/quicksettings/network/utils"

export default () => {
  const network = Network.get_default()
  const [iconName, setIconName] = createState("network-no-route-symbolic")
  const [visible, setVisible] = createState(false)

  onMount(() => {
    let wifiSignalIds: number[] = []

    const cleanupWifiSignals = () => {
      const w = network.wifi
      for (const id of wifiSignalIds) {
        if (w) w.disconnect(id)
      }
      wifiSignalIds = []
    }

    const update = () => {
      const primary = network.primary
      setVisible(primary !== Network.Primary.UNKNOWN)

      if (primary === Network.Primary.WIFI) {
        const w = network.wifi
        if (!w) {
          setIconName("network-wireless-offline-symbolic")
          return
        }
        setIconName(wifiIconName(w.strength, w.enabled, w.state))
      } else if (primary === Network.Primary.WIRED) {
        const wired = network.wired
        setIconName(wired?.iconName || "network-wired-offline-symbolic")
      } else {
        setIconName("network-no-route-symbolic")
      }
    }

    network.connect("notify::primary", update)
    network.connect("notify::wifi", () => {
      cleanupWifiSignals()
      const w = network.wifi
      if (w) {
        wifiSignalIds.push(w.connect("notify::state", update))
        wifiSignalIds.push(w.connect("notify::strength", update))
        wifiSignalIds.push(w.connect("notify::enabled", update))
      }
      update()
    })
    network.connect("notify::wired", update)

    const w = network.wifi
    if (w) {
      wifiSignalIds.push(w.connect("notify::state", update))
      wifiSignalIds.push(w.connect("notify::strength", update))
      wifiSignalIds.push(w.connect("notify::enabled", update))
    }

    update()
  })

  return (
    <Gtk.Image
      iconName={iconName}
      visible={visible}
      pixelSize={18}
    />
  )
}
