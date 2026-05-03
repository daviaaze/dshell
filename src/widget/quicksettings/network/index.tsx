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
    ap: Network.AccessPoint,
    entry: Gtk.Entry
  } | null>(null)

  const isConnecting = connectingAp.as(c => c !== null)

  // Bind to wifi properties directly so they update after sleep/resume.
  // network.wifi never changes reference, but its properties do.
  const wifi = network.wifi
  const wifiIconName = wifi
    ? createBinding(wifi, "iconName").as(icon => icon || "network-wireless-offline-symbolic")
    : () => "network-wireless-offline-symbolic"
  const wifiSsid = wifi ? createBinding(wifi, "ssid") : () => null
  const wifiEnabled = wifi ? createBinding(wifi, "enabled") : () => false

  const popover = (
    <Gtk.Popover>
      <LinkedPopoverBox>
        <With value={wifiBinding}>
          {(wifi: Network.Wifi | null) => wifi
            ? <WifiPopover
                wifi={wifi}
                connectingAp={connectingAp}
                setConnectingAp={setConnectingAp}
                setPasswordDialog={setPasswordDialog}
              />
            : <Gtk.Label
                cssClasses={["popover-padded-lg"]}
                label="No WiFi device" />}
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
      icon={createComputed([
        isConnecting,
        wifiIconName,
      ], (connecting, icon) =>
        connecting ? "content-loading-symbolic" : icon
      )}
      label={wifiSsid.as(ssid => {
        if (!ssid || ssid === "..." || ssid.trim() === "")
          return wifiEnabled.get() ? "WiFi" : "WiFi Off"
        return ssid.length > 12 ? ssid.slice(0, 12) + "…" : ssid
      })}
      onClick={() => {
        const wifi = wifiBinding.get()
        if (!wifi) return
        if (wifi.state === Network.DeviceState.ACTIVATED) {
          wifi.deactivate_connection()
            .catch((e: Error) => print("deactivate failed:", e.message))
        } else {
          wifi.enabled = !wifi.enabled
        }
      }}
      popover={popover}
    />
  )
}
