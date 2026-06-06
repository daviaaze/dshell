import Network from "gi://AstalNetwork"
import NM from "gi://NM?version=1.0"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, With, For } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import {
  ssidOf,
  bssidOf,
  isSaved,
  isSecure,
  securityLabel,
  strengthFraction,
  wifiIconName,
} from "#/widget/quicksettings/network/utils"
import logger from "#/lib/logger"

// ── Helpers ────────────────────────────────────────────────────────

/** Get all known (saved) WiFi connections across all access points. */
function getKnownNetworks(
  wifi: Network.Wifi,
): { ssid: string; secure: boolean; secLabel: string; connections: NM.RemoteConnection[] }[] {
  const seen = new Set<string>()
  const results: { ssid: string; secure: boolean; secLabel: string; connections: NM.RemoteConnection[] }[] = []

  const aps = toArray<Network.AccessPoint>(wifi.accessPoints)
  for (const ap of aps) {
    const ssid = ssidOf(ap)
    if (seen.has(ssid)) continue
    const conns = ap.get_connections()
    if (!conns) continue
    const connArr = toArray<NM.RemoteConnection>(conns)
    if (connArr.length === 0) continue
    seen.add(ssid)
    results.push({
      ssid,
      secure: isSecure(ap),
      secLabel: securityLabel(ap),
      connections: connArr,
    })
  }

  return results.sort((a, b) => a.ssid.localeCompare(b.ssid))
}

// ── Connection Editor Dialog ───────────────────────────────────────

function showConnectionEditor(
  ssid: string,
  connections: NM.RemoteConnection[],
  parent: Gtk.Widget,
) {
  if (connections.length === 0) return

  const conn = connections[0]
  const settingConn = conn.get_setting_connection()
  const settingWireless = conn.get_setting_wireless()
  const settingSecurity = conn.get_setting_wireless_security()
  const isSecureConn = settingSecurity !== null

  const dialog = new Adw.Window({
    transientFor: parent.get_root() as Gtk.Window,
    modal: true,
    title: ssid,
    defaultWidth: 400,
    defaultHeight: 300,
    cssClasses: ["background"],
  })

  const [autoConnect, setAutoConnect] = createState(
    settingConn ? settingConn.autoconnect : true,
  )
  const [password, setPassword] = createState(
    isSecureConn ? (settingSecurity?.psk ?? "") : "",
  )
  const [showPassword, setShowPassword] = createState(false)
  const [saving, setSaving] = createState(false)
  const [errorMsg, setErrorMsg] = createState<string | null>(null)

  const saveChanges = () => {
    setSaving(true)
    setErrorMsg(null)

    try {
      if (settingConn) {
        settingConn.autoconnect = autoConnect.get()
      }
      if (settingSecurity && isSecureConn) {
        const pwd = password.get()
        if (pwd) {
          settingSecurity.psk = pwd
        }
      }
      conn.commit_changes_async(true, null).catch((e: Error) => {
        logger.error("settings-network", "commit failed:", e.message)
        setErrorMsg(e.message || "Failed to save")
        setSaving(false)
      }).then(() => {
        setSaving(false)
        dialog.close()
      })
    } catch (e) {
      logger.error("settings-network", "save error:", e)
      setErrorMsg(String(e))
      setSaving(false)
    }
  }

  const forgetNetwork = () => {
    conn.delete_async(null)
      .then(() => dialog.close())
      .catch((e: Error) =>
        logger.error("settings-network", "forget failed:", e.message),
      )
  }

  dialog.set_content(
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Adw.HeaderBar
        titleWidget={
          <Adw.WindowTitle title={ssid} cssClasses={["title-3"]} /> as Gtk.Widget
        }
        showEndTitleButtons={false}
      />
      <Gtk.ScrolledWindow
        propagateNaturalHeight
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      >
        <Adw.PreferencesPage>
          <Adw.PreferencesGroup title="Connection" description={securityLabel({ rsnFlags: 0, wpaFlags: 0, flags: 0 } as any) || "Unknown"}>
            <Adw.SwitchRow
              title="Connect automatically"
              active={autoConnect}
              onNotifyActive={(self) => setAutoConnect(self.active)}
            />
          </Adw.PreferencesGroup>

          {isSecureConn && (
            <Adw.PreferencesGroup title="Security">
              <Adw.EntryRow title="Password">
                <Gtk.Entry
                  placeholderText="WiFi password"
                  visibility={showPassword.get()}
                  text={password.get()}
                  $={(entry) => {
                    entry.connect("notify::text", () => {
                      setPassword(entry.get_text())
                    })
                  }}
                />
                <Gtk.Button
                  $type="suffix"
                  cssClasses={["flat"]}
                  onClicked={() => setShowPassword(!showPassword.get())}
                >
                  <Gtk.Image
                    iconName={
                      showPassword.get()
                        ? "eye-not-looking-symbolic"
                        : "eye-open-negative-filled-symbolic"
                    }
                    pixelSize={16}
                  />
                </Gtk.Button>
              </Adw.EntryRow>
            </Adw.PreferencesGroup>
          )}

          <Adw.PreferencesGroup>
            <Adw.ActionRow>
              <Gtk.Button
                hexpand
                cssClasses={["suggested-action"]}
                label={saving.as((s) => (s ? "Saving…" : "Save Changes"))}
                sensitive={saving.as((s) => !s)}
                onClicked={saveChanges}
              />
            </Adw.ActionRow>
            <Adw.ActionRow>
              <Gtk.Button
                hexpand
                cssClasses={["destructive-action"]}
                label="Forget Network"
                onClicked={forgetNetwork}
              />
            </Adw.ActionRow>
          </Adw.PreferencesGroup>

          <Gtk.Label
            label={errorMsg.as((e) => e ?? "")}
            cssClasses={["error", "caption"]}
            visible={errorMsg.as((e) => e !== null)}
            wrap
            marginStart={12}
            marginEnd={12}
            marginBottom={12}
          />
        </Adw.PreferencesPage>
      </Gtk.ScrolledWindow>
    </Gtk.Box>,
  )

  dialog.present()
}

// ── Hidden Network Dialog ──────────────────────────────────────────

function showHiddenNetworkDialog(parent: Gtk.Widget) {
  const dialog = new Adw.Window({
    transientFor: parent.get_root() as Gtk.Window,
    modal: true,
    title: "Connect to Hidden Network",
    defaultWidth: 400,
    defaultHeight: 250,
    cssClasses: ["background"],
  })

  const [ssid, setSsid] = createState("")
  const [password, setPassword] = createState("")
  const [connecting, setConnecting] = createState(false)
  const [errorMsg, setErrorMsg] = createState<string | null>(null)

  const connect = () => {
    const name = ssid.get().trim()
    if (!name) {
      setErrorMsg("Network name is required")
      return
    }
    setConnecting(true)
    setErrorMsg(null)

    const network = Network.get_default()
    const wifi = network.wifi
    if (!wifi) {
      setErrorMsg("No WiFi device available")
      setConnecting(false)
      return
    }

    // Use NM to create and activate a connection for the hidden network
    try {
      const client = network.client
      const connection = new NM.SimpleConnection()

      // Connection settings
      const sCon = new NM.SettingConnection()
      sCon.type = "802-11-wireless"
      sCon.uuid = GLib.uuid_string_random() ?? undefined
      sCon.id = name

      // Wireless settings
      const sWifi = new NM.SettingWireless()
      sWifi.ssid = new GLib.Bytes(name) as any
      sWifi.mode = "infrastructure"
      sWifi.hidden = true

      connection.add_setting(sCon)
      connection.add_setting(sWifi)

      // Security settings if password provided
      const pwd = password.get().trim()
      if (pwd) {
        const sSec = new NM.SettingWirelessSecurity()
        sSec.key_mgmt = "wpa-psk"
        sSec.psk = pwd
        connection.add_setting(sSec)
      }

      client.add_and_activate_connection_async(
        connection,
        wifi.device,
        null,
        null,
      ).then(() => {
        setConnecting(false)
        dialog.close()
      }).catch((e: Error) => {
        logger.error("settings-network", "hidden connect failed:", e.message)
        setErrorMsg(e.message || "Connection failed")
        setConnecting(false)
      })
    } catch (e) {
      logger.error("settings-network", "hidden network error:", e)
      setErrorMsg(String(e))
      setConnecting(false)
    }
  }

  dialog.set_content(
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Adw.HeaderBar
        titleWidget={
          <Adw.WindowTitle title="Hidden Network" cssClasses={["title-3"]} /> as Gtk.Widget
        }
        showEndTitleButtons={false}
      />
      <Adw.PreferencesPage>
        <Adw.PreferencesGroup title="Network Details">
          <Adw.EntryRow title="Network Name">
            <Gtk.Entry
              placeholderText="SSID"
              $={(entry) => {
                entry.connect("notify::text", () => setSsid(entry.get_text()))
              }}
            />
          </Adw.EntryRow>
          <Adw.EntryRow title="Password">
            <Gtk.Entry
              placeholderText="Password (optional)"
              visibility={false}
              $={(entry) => {
                entry.connect("notify::text", () => setPassword(entry.get_text()))
              }}
            />
          </Adw.EntryRow>
        </Adw.PreferencesGroup>

        <Adw.PreferencesGroup>
          <Adw.ActionRow>
            <Gtk.Button
              hexpand
              cssClasses={["suggested-action"]}
              label={connecting.as((c) => (c ? "Connecting…" : "Connect"))}
              sensitive={connecting.as((c) => !c)}
              onClicked={connect}
            />
          </Adw.ActionRow>
          <Adw.ActionRow>
            <Gtk.Button
              hexpand
              label="Cancel"
              onClicked={() => dialog.close()}
            />
          </Adw.ActionRow>
        </Adw.PreferencesGroup>

        <Gtk.Label
          label={errorMsg.as((e) => e ?? "")}
          cssClasses={["error", "caption"]}
          visible={errorMsg.as((e) => e !== null)}
          wrap
          marginStart={12}
          marginEnd={12}
          marginBottom={12}
        />
      </Adw.PreferencesPage>
    </Gtk.Box>,
  )

  dialog.present()
}

// ── Hotspot Controls ───────────────────────────────────────────────

function HotspotSection({ wifi }: { wifi: Network.Wifi }) {
  const isHotspot = createBinding(wifi, "isHotspot")
  const scanning = createBinding(wifi, "scanning")

  return (
    <Adw.PreferencesGroup title="Hotspot" description="Share your internet connection over Wi-Fi">
      <Adw.ActionRow
        title="Hotspot"
        subtitle={isHotspot.as((h) => (h ? "Active" : "Inactive"))}
      >
        <Gtk.Switch
          $type="suffix"
          valign={Gtk.Align.CENTER}
          active={isHotspot}
          onNotifyActive={(self) => {
            // Toggle hotspot — this requires NM API
            // For now, just note that it's not directly supported by AstalNetwork
            logger.info("settings-network", "Hotspot toggle not yet implemented")
          }}
        />
      </Adw.ActionRow>
    </Adw.PreferencesGroup>
  )
}

// ── Main Settings Page ─────────────────────────────────────────────

export default () => {
  const network = Network.get_default()
  const wifi = createBinding(network, "wifi")
  const wired = createBinding(network, "wired")

  return (
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      {/* WiFi Section */}
      <Adw.PreferencesGroup title="Wi-Fi" description="Wireless network connections">
        <With value={wifi}>
          {(w) =>
            w ? (
              <Adw.SwitchRow
                title="Wi-Fi"
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
                  value={createBinding(w, "strength").as((s) => strengthFraction(s))}
                  widthRequest={50}
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
              <Adw.ActionRow
                title="Scan for Networks"
                activatable
                onActivated={() => w.scan()}
              >
                <Gtk.Image
                  $type="prefix"
                  iconName="view-refresh-symbolic"
                  pixelSize={16}
                />
              </Adw.ActionRow>
            ) : (
              <></>
            )
          }
        </With>
        <Adw.ActionRow
          title="Connect to Hidden Network…"
          activatable
          onActivated={(self) => showHiddenNetworkDialog(self)}
        >
          <Gtk.Image
            $type="prefix"
            iconName="network-wireless-symbolic"
            pixelSize={16}
          />
        </Adw.ActionRow>
      </Adw.PreferencesGroup>

      {/* Known Networks Section */}
      <With value={wifi}>
        {(w) => {
          if (!w) return <></>

          const knownNetworks = createComputed(
            [createBinding(w, "accessPoints")],
            () => getKnownNetworks(w),
          )

          return (
            <Adw.PreferencesGroup
              title="Known Networks"
              description="Saved Wi-Fi networks"
            >
              <For each={knownNetworks}>
                {(net: { ssid: string; secure: boolean; secLabel: string; connections: NM.RemoteConnection[] }) => (
                  <Adw.ActionRow
                    title={net.ssid}
                    subtitle={net.secLabel}
                    activatable
                    onActivated={(self) => showConnectionEditor(net.ssid, net.connections, self)}
                  >
                    <Gtk.Image
                      $type="prefix"
                      iconName={
                        net.secure
                          ? "network-wireless-encrypted-symbolic"
                          : "network-wireless-signal-none-symbolic"
                      }
                      pixelSize={16}
                    />
                    <Gtk.Button
                      $type="suffix"
                      cssClasses={["flat", "circular"]}
                      onClicked={() => {
                        for (const conn of net.connections) {
                          conn.delete_async(null).catch((e: Error) =>
                            logger.error("settings-network", "forget failed:", e.message),
                          )
                        }
                      }}
                      tooltipText="Forget Network"
                    >
                      <Gtk.Image iconName="user-trash-symbolic" pixelSize={14} />
                    </Gtk.Button>
                  </Adw.ActionRow>
                )}
              </For>
            </Adw.PreferencesGroup>
          )
        }}
      </With>

      {/* Wired Section */}
      <Adw.PreferencesGroup title="Wired" description="Ethernet connection">
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
      </Adw.PreferencesGroup>

      {/* Hotspot Section */}
      <With value={wifi}>
        {(w) => (w ? <HotspotSection wifi={w} /> : <></>)}
      </With>

      {/* Connectivity Section */}
      <Adw.PreferencesGroup title="Connectivity" description="Internet access status">
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
    </Gtk.Box>
  )
}
