import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, With } from "gnim"

export default () => {
  const network = Network.get_default()
  const wifi = createBinding(network, "wifi")
  const wired = createBinding(network, "wired")

  return (
    <Adw.PreferencesGroup title="Network" description="Network connections">
      <With value={wifi}>
        {(w) =>
          w ? (
            <Adw.SwitchRow
              title="WiFi"
              subtitle={createBinding(w, "ssid").as((ssid) =>
                ssid ? `Connected to ${ssid}` : "Not connected",
              )}
              active={createBinding(w, "enabled")}
              onNotifyActive={(self) => {
                w.enabled = self.active
              }}
            />
          ) : (
            <></>
          )
        }
      </With>
      <With value={wifi}>
        {(w) =>
          w ? (
            <Adw.ActionRow
              title="Signal Strength"
              subtitle={createBinding(w, "strength").as((s) => `${s}%`)}
            >
              <Gtk.LevelBar
                $type="suffix"
                valign={Gtk.Align.CENTER}
                value={createBinding(w, "strength").as((s) => s / 100)}
              />
            </Adw.ActionRow>
          ) : (
            <></>
          )
        }
      </With>
      <With value={wifi}>
        {(w) =>
          w ? (
            <Adw.ButtonRow
              title="Scan for Networks"
              startIconName="view-refresh-symbolic"
              onActivated={() => w.scan()}
            />
          ) : (
            <></>
          )
        }
      </With>
      <With value={wired}>
        {(w) =>
          w ? (
            <Adw.ActionRow
              title="Wired Connection"
              subtitle={createBinding(w, "state").as((s) =>
                s === Network.DeviceState.ACTIVATED
                  ? "Connected"
                  : "Disconnected",
              )}
            >
              <Gtk.Image
                $type="suffix"
                iconName={createBinding(w, "iconName")}
                pixelSize={20}
              />
            </Adw.ActionRow>
          ) : (
            <></>
          )
        }
      </With>
      <Adw.ActionRow
        title="Connectivity"
        subtitle={createBinding(network, "connectivity").as((c) =>
          c === Network.Connectivity.FULL
            ? "Full internet access"
            : c === Network.Connectivity.LIMITED
              ? "Limited connectivity"
              : "No connectivity",
        )}
      />
    </Adw.PreferencesGroup>
  )
}
