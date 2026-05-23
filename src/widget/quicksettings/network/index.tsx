import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, createState, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import logger from "#/lib/logger"
import WifiPopover from "./wifiPopover"
import PasswordDialog from "./passwordDialog"

export default () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()
  logger.log("Network: wifi binding")
  const wifiBinding = createBinding(network, "wifi")

  const [connectingAp, setConnectingAp] = createState<string | null>(null)
  const [passwordDialog, setPasswordDialog] = createState<{
    ap: Network.AccessPoint
    entry: Gtk.Entry
  } | null>(null)

  const isConnecting = connectingAp.as((c) => c !== null)

  // Track wifi device reactively via binding — network.wifi may be null
  // at startup if the hardware wasn't ready, and can change after sleep/resume.
  const wifiIconName = wifiBinding.as(
    (wifi) => wifi?.iconName || "network-wireless-offline-symbolic",
  )
  const wifiSsid = wifiBinding.as((wifi) => wifi?.ssid ?? null)
  const wifiEnabled = wifiBinding.as((wifi) => wifi?.enabled ?? false)

  const popover = (
    <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT} maxContentWidth={340}>
      <LinkedPopoverBox>
        <With value={wifiBinding}>
          {(wifi: Network.Wifi | null) =>
            wifi ? (
              <WifiPopover
                wifi={wifi}
                connectingAp={connectingAp}
                setConnectingAp={setConnectingAp}
                setPasswordDialog={setPasswordDialog}
              />
            ) : (
              <Gtk.Label
                cssClasses={["popover-padded-lg"]}
                label="No WiFi device"
              />
            )
          }
        </With>
        <PasswordDialog
          passwordDialog={passwordDialog}
          setPasswordDialog={setPasswordDialog}
          setConnectingAp={setConnectingAp}
        />
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      icon={createComputed([isConnecting, wifiIconName], (connecting, icon) =>
        connecting ? "content-loading-symbolic" : icon,
      )}
      label={wifiSsid.as((ssid) => {
        if (!ssid || ssid === "..." || ssid.trim() === "")
          return wifiEnabled.get() ? "WiFi" : "WiFi Off"
        return ssid.length > 24 ? ssid.slice(0, 24) + "…" : ssid
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
