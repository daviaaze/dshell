import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () => {
  const network = Network.get_default()
  const wifi = network.wifi
  const wired = network.wired

  return <Adw.PreferencesGroup
    title="Network"
    description="Network connections">
    <Adw.SwitchRow
      visible={wifi !== null}
      title="WiFi"
      subtitle={wifi ? createBinding(wifi, "ssid").as(ssid =>
        ssid ? `Connected to ${ssid}` : "Not connected"
      ) : ""}
      active={wifi ? createBinding(wifi, "enabled") : false}
      onNotifyActive={self => {
        if (wifi) wifi.enabled = self.active
      }}
    />
    <Adw.ActionRow
      visible={wifi !== null}
      title="Signal Strength"
      subtitle={wifi ? createBinding(wifi, "strength").as(s => `${s}%`) : ""}>
      <Gtk.LevelBar
        $type="suffix"
        valign={Gtk.Align.CENTER}
        value={wifi ? createBinding(wifi, "strength").as(s => s / 100) : 0}
      />
    </Adw.ActionRow>
    <Adw.ButtonRow
      visible={wifi !== null}
      title="Scan for Networks"
      startIconName="view-refresh-symbolic"
      onActivated={() => wifi?.scan()}
    />
    <Adw.ActionRow
      visible={wired !== null}
      title="Wired Connection"
      subtitle={wired ? createBinding(wired, "state").as(s =>
        s === Network.DeviceState.ACTIVATED ? "Connected" : "Disconnected"
      ) : ""}>
      <Gtk.Image
        $type="suffix"
        iconName={wired ? createBinding(wired, "iconName") : ""}
        pixelSize={20}
      />
    </Adw.ActionRow>
    <Adw.ActionRow
      title="Connectivity"
      subtitle={createBinding(network, "connectivity").as(c =>
        c === Network.Connectivity.FULL ? "Full internet access" :
          c === Network.Connectivity.LIMITED ? "Limited connectivity" :
            "No connectivity"
      )}
    />
  </Adw.PreferencesGroup>
}
