import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, createState, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import { wifiIconName } from "./utils"
import logger from "#/lib/logger"
import WifiPopover from "./wifiPopover"

export default () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()
  logger.log("Network: wifi binding")
  const wifiBinding = createBinding(network, "wifi")

  const [connectingAp, setConnectingAp] = createState<string | null>(null)

  const isConnecting = connectingAp.as((connecting) => connecting !== null)

  // Track wifi device reactively via binding — network.wifi may be null
  // at startup if the hardware wasn't ready, and can change after sleep/resume.

  // Compute icon from our own helper, not AstalNetwork's unreliable iconName
  const wifiIconName_ = createComputed(
    [wifiBinding],
    (wifi) => {
      if (!wifi) return "network-wireless-offline-symbolic"
      return wifiIconName(wifi.strength, wifi.enabled, wifi.state)
    },
  )

  const wifiSsid = wifiBinding.as((wifi) => wifi?.ssid ?? null)
  const wifiEnabled = wifiBinding.as((wifi) => wifi?.enabled ?? false)

  // Blue "suggested-action" when connected (matching Bluetooth pattern)
  const wifiCssClasses = createComputed(
    [wifiBinding],
    (wifi) => {
      if (wifi?.state === Network.DeviceState.ACTIVATED) {
        return ["raised", "suggested-action"]
      }
      return ["raised"]
    },
  )

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <With value={wifiBinding}>
          {(wifi: Network.Wifi | null) =>
            wifi ? (
              <WifiPopover
                wifi={wifi}
                connectingAp={connectingAp}
                setConnectingAp={setConnectingAp}
              />
            ) : (
              <Gtk.Label
                cssClasses={["popover-padded-lg"]}
                label="No WiFi device"
              />
            )
          }
        </With>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      icon={createComputed([isConnecting, wifiIconName_], (connecting, icon) =>
        connecting ? "content-loading-symbolic" : icon,
      )}
      cssClasses={wifiCssClasses}
      label={wifiSsid.as((ssid) => {
        if (!ssid || ssid === "..." || ssid.trim() === "")
          return wifiEnabled.get() ? "WiFi" : "WiFi Off"
        return ssid.length > 12 ? ssid.slice(0, 12) + "…" : ssid
      })}
      onClick={() => {
        const wifi = wifiBinding.get()
        if (!wifi) return
        if (wifi.state === Network.DeviceState.ACTIVATED) {
          wifi
            .deactivate_connection()
            .catch((e: Error) =>
              logger.error("network", "deactivate failed:", e.message),
            )
        } else {
          wifi.enabled = !wifi.enabled
        }
      }}
      popover={popover}
    />
  )
}
