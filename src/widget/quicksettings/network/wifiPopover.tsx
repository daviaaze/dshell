import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, Accessor } from "gnim"
import ApList from "./apList"

interface WifiPopoverProps {
  wifi: Network.Wifi
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
  setPasswordDialog: (
    v: { ap: Network.AccessPoint; entry: Gtk.Entry } | null,
  ) => void
}

export default ({
  wifi,
  connectingAp,
  setConnectingAp,
  setPasswordDialog,
}: WifiPopoverProps) => {
  const wifiEnabled = createBinding(wifi, "enabled")

  return (
    <Gtk.Box
      cssClasses={["linked"]}
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <Gtk.Box spacing={4}>
        <Gtk.Button hexpand onClicked={() => wifi.scan()}>
          <Adw.ButtonContent iconName="view-refresh-symbolic" label="Scan" />
        </Gtk.Button>
        <Gtk.Button onClicked={() => (wifi.enabled = !wifi.enabled)}>
          <Adw.ButtonContent
            iconName={wifiEnabled.as((enabled) =>
              enabled
                ? "network-wireless-disabled-symbolic"
                : "network-wireless-symbolic",
            )}
            label={wifiEnabled.as((enabled) => (enabled ? "Off" : "On"))}
          />
        </Gtk.Button>
      </Gtk.Box>
      <Gtk.ScrolledWindow
        propagateNaturalHeight={true}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      >
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
          <ApList
            wifi={wifi}
            connectingAp={connectingAp}
            setConnectingAp={setConnectingAp}
            setPasswordDialog={setPasswordDialog}
          />
        </Gtk.Box>
      </Gtk.ScrolledWindow>
    </Gtk.Box>
  )
}
