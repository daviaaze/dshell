import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, Accessor } from "gnim"
import ApList from "./apList"

interface WifiPopoverProps {
  wifi: Network.Wifi
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
}

export default ({
  wifi,
  connectingAp,
  setConnectingAp,
}: WifiPopoverProps) => {
  const wifiEnabled = createBinding(wifi, "enabled")
  const scanning = createBinding(wifi, "scanning")

  return (
    <Gtk.Box
      cssClasses={["linked"]}
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <Gtk.Box spacing={4}>
        <Gtk.Button hexpand onClicked={() => wifi.scan()}>
          <Adw.ButtonContent
            iconName={scanning.as((s) =>
              s ? "content-loading-symbolic" : "view-refresh-symbolic",
            )}
            label="Scan"
          />
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
        widthRequest={360}
        maxContentHeight={350}
        propagateNaturalHeight={true}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
      >
        <ApList
          wifi={wifi}
          connectingAp={connectingAp}
          setConnectingAp={setConnectingAp}
        />
      </Gtk.ScrolledWindow>
    </Gtk.Box>
  )
}
