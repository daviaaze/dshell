import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createState, For, With } from "gnim"

const network = Network.get_default()

function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  // GJS GLib.List may expose items directly or nested in .data
  // Try .data first, fall back to the node itself
  while (l) {
    const item = l.data !== undefined ? l.data : l
    if (item !== undefined && item !== null) {
      arr.push(item)
    }
    l = l.next
  }
  return arr
}

function listLength(list: any): number {
  if (!list) return 0
  if (Array.isArray(list)) return list.length
  let count = 0
  let l = list
  while (l) {
    count++
    l = l.next
  }
  return count
}

/**
 * NetworkManager exposes SSIDs and BSSIDs as byte arrays (Uint8Array).
 * GJS may not auto-convert them to strings. This helper safely converts.
 */
function bytesToString(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  // Handle GBytes / Uint8Array
  if (value instanceof Uint8Array) {
    // Find null terminator if present
    let len = value.length
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) {
        len = i
        break
      }
    }
    if (len === 0) return ""
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(value.subarray(0, len))
    } catch {
      return null
    }
  }
  // Handle GLib.Bytes or other array-like objects
  if (typeof value.toString === "function") {
    const str = value.toString()
    if (str && !str.startsWith("[object ")) return str
  }
  return null
}

function ssidOf(ap: Network.AccessPoint): string {
  return bytesToString(ap.ssid) ?? "Hidden Network"
}

function bssidOf(ap: Network.AccessPoint): string | null {
  return bytesToString(ap.bssid)
}

function bssidEquals(a: any, b: any): boolean {
  const sa = bytesToString(a)
  const sb = bytesToString(b)
  if (sa === null || sb === null) return false
  return sa.toLowerCase() === sb.toLowerCase()
}

export default () => {
  const wifiBinding = createBinding(network, "wifi")

  const [connectingAp, setConnectingAp] = createState<string | null>(null)
  const [passwordDialog, setPasswordDialog] = createState<{
    ap: Network.AccessPoint,
    entry: Gtk.Entry
  } | null>(null)

  const WifiPopover = ({ wifi }: { wifi: Network.Wifi }) => {
    const aps = createBinding(wifi, "accessPoints")
      .as(points => toArray<Network.AccessPoint>(points))

    const wifiEnabled = createBinding(wifi, "enabled")

    return <Gtk.Box
      cssClasses={["linked"]}
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={4}>
        <Gtk.Button
          hexpand
          onClicked={() => wifi.scan()}>
          <Adw.ButtonContent
            iconName="view-refresh-symbolic"
            label="Scan" />
        </Gtk.Button>
        <Gtk.Button
          onClicked={() => wifi.enabled = !wifi.enabled}>
          <Adw.ButtonContent
            iconName={wifiEnabled.as(enabled =>
              enabled
                ? "network-wireless-disabled-symbolic"
                : "network-wireless-symbolic"
            )}
            label={wifiEnabled.as(enabled =>
              enabled ? "Off" : "On"
            )} />
        </Gtk.Button>
      </Gtk.Box>
      <Gtk.ScrolledWindow
        maxContentHeight={300}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
        <Gtk.Box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={4}>
          <For each={aps}>
            {(ap: Network.AccessPoint) => {
              const apSsid = ssidOf(ap)
              const apBssid = bssidOf(ap)

              const isActive = createBinding(wifi, "activeAccessPoint")
                .as(active => {
                  if (!active || !apBssid) return false
                  return bssidEquals(active.bssid, ap.bssid)
                })
              const isConnecting = connectingAp.as(c =>
                apBssid !== null && c !== null && bssidEquals(c, ap.bssid)
              )

              return <Gtk.Button
                onClicked={() => {
                  if (isActive.get()) {
                    wifi.deactivate_connection()
                      .catch((e: Error) => print("deactivate failed:", e.message))
                    return
                  }
                  const conns = ap.get_connections()
                  const hasSaved = listLength(conns) > 0
                  if (ap.requires_password && !hasSaved) {
                    const entry = new Gtk.Entry({
                      placeholderText: "Password",
                    })
                    entry.set_visibility(false)
                    setPasswordDialog({ ap, entry })
                    return
                  }
                  if (apBssid) setConnectingAp(apBssid)
                  ap.activate()
                    .then(() => setConnectingAp(null))
                    .catch((e: Error) => {
                      print("activate failed:", e.message)
                      setConnectingAp(null)
                    })
                }}>
                <Gtk.Box spacing={8}>
                  <Gtk.Image
                    iconName={typeof ap.iconName === "string" ? ap.iconName : "network-wireless-symbolic"}
                    pixelSize={16}
                  />
                  <Gtk.Label
                    hexpand
                    halign={Gtk.Align.START}
                    label={apSsid}
                  />
                  <With value={isActive}>
                    {(active: boolean) => active
                      ? <Gtk.Image
                          iconName="emblem-ok-symbolic"
                          pixelSize={16}
                        />
                      : <With value={isConnecting}>
                          {(connecting: boolean) => connecting
                            ? <Gtk.Spinner
                                spinning
                                marginEnd={4}
                              />
                            : null}
                        </With>}
                  </With>
                </Gtk.Box>
              </Gtk.Button>
            }}
          </For>
        </Gtk.Box>
      </Gtk.ScrolledWindow>
    </Gtk.Box>
  }

  const PasswordDialog = () => {
    const dialog = passwordDialog.get()
    if (!dialog) return null

    return <Gtk.Revealer
      revealChild={passwordDialog.as(d => d !== null)}>
      <Gtk.Box spacing={4}>
        {dialog.entry}
        <Gtk.Button
          cssClasses={["suggested-action"]}
          onClicked={() => {
            const pw = dialog.entry.get_text()
            const ap = dialog.ap
            setPasswordDialog(null)
            const bssid = bssidOf(ap)
            if (bssid) setConnectingAp(bssid)
            ap.activate(pw)
              .then(() => setConnectingAp(null))
              .catch((e: Error) => {
                print("activate with password failed:", e.message)
                setConnectingAp(null)
              })
          }}>
          <Gtk.Image iconName="go-next-symbolic" />
        </Gtk.Button>
        <Gtk.Button
          onClicked={() => setPasswordDialog(null)}>
          <Gtk.Image iconName="window-close-symbolic" />
        </Gtk.Button>
      </Gtk.Box>
    </Gtk.Revealer>
  }

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
              ? <WifiPopover wifi={wifi} />
              : <Gtk.Label
                  marginStart={12}
                  marginEnd={12}
                  marginTop={12}
                  marginBottom={12}
                  label="No WiFi device" />}
          </With>
          <PasswordDialog />
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}>
    <Adw.ButtonContent
      iconName={wifiBinding.as(wifi =>
        wifi?.iconName ?? "network-wireless-offline-symbolic"
      )}
      label={wifiBinding.as(wifi =>
        wifi?.ssid ?? (wifi?.enabled ? "WiFi" : "WiFi Off")
      )} />
  </Adw.SplitButton>
}
