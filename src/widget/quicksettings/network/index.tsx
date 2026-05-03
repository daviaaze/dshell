import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, createState, With } from "gnim"
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

  return <Adw.SplitButton
    cssClasses={["raised"]}
    widthRequest={150}
    $={self => {
      self.connect("clicked", () => {
        const wifi = wifiBinding.get()
        if (!wifi) return
        if (wifi.state === Network.DeviceState.ACTIVATED) {
          wifi.deactivate_connection()
            .catch((e: Error) => print("deactivate failed:", e.message))
        } else {
          wifi.enabled = !wifi.enabled
        }
      })
      self.connect("destroy", () => {
        const popover = self.popover
        if (popover?.parent) popover.unparent()
      })
    }}
    popover={
      <Gtk.Popover cssClasses={[]}>
        <Gtk.Box
          cssClasses={["linked"]}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={4}
          marginStart={8}
          marginEnd={8}
          marginTop={8}
          marginBottom={8}>
          <With value={wifiBinding}>
            {(wifi: Network.Wifi | null) => wifi
              ? <WifiPopover
                  wifi={wifi}
                  connectingAp={connectingAp}
                  setConnectingAp={setConnectingAp}
                  setPasswordDialog={setPasswordDialog}
                />
              : <Gtk.Label
                  marginStart={12}
                  marginEnd={12}
                  marginTop={12}
                  marginBottom={12}
                  label="No WiFi device" />}
          </With>
          <PasswordDialog
            passwordDialog={passwordDialog}
            setPasswordDialog={setPasswordDialog}
            setConnectingAp={setConnectingAp}
          />
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}>
    <Adw.ButtonContent
      iconName={createComputed([
        isConnecting,
        wifiIconName,
      ], (connecting, icon) =>
        connecting ? "content-loading-symbolic" : icon
      )}
      label={wifiSsid.as(ssid => {
        if (!ssid || ssid === "..." || ssid.trim() === "")
          return wifiEnabled.get() ? "WiFi" : "WiFi Off"
        return ssid.length > 12 ? ssid.slice(0, 12) + "…" : ssid
      })} />
  </Adw.SplitButton>
}
