import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createState, With } from "gnim"
import WifiPopover from "./wifiPopover"
import PasswordDialog from "./passwordDialog"

const network = Network.get_default()

export default () => {
  const wifiBinding = createBinding(network, "wifi")

  const [connectingAp, setConnectingAp] = createState<string | null>(null)
  const [passwordDialog, setPasswordDialog] = createState<{
    ap: Network.AccessPoint,
    entry: Gtk.Entry
  } | null>(null)

  const isConnecting = connectingAp.as(c => c !== null)

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
    <Gtk.Box
      spacing={8}
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}>
      {isConnecting.as(connecting => connecting
        ? <Gtk.Spinner spinning />
        : <Gtk.Image
            iconName={wifiBinding.as(wifi =>
              wifi?.iconName || "network-wireless-offline-symbolic"
            )}
          />)}
      <Gtk.Label
        label={wifiBinding.as(wifi => {
          const ssid = wifi?.ssid
          if (!ssid || ssid === "..." || ssid.trim() === "")
            return wifi?.enabled ? "WiFi" : "WiFi Off"
          return ssid
        })} />
    </Gtk.Box>
  </Adw.SplitButton>
}
