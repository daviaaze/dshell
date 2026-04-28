import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createState, For } from "gnim"

const network = Network.get_default()

function toArray<T>(list: any): T[] {
  if (!list) return []
  if (Array.isArray(list)) return list
  const arr: T[] = []
  let l = list
  while (l) {
    arr.push(l.data)
    l = l.next
  }
  return arr
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
            iconName={wifi.enabled ?
              "network-wireless-disabled-symbolic" :
              "network-wireless-symbolic"}
            label={wifi.enabled ? "Off" : "On"} />
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
              const isActive = createBinding(wifi, "activeAccessPoint")
                .as(active => active?.bssid === ap.bssid)
              const isConnecting = connectingAp.as(c => c === ap.bssid)

              return <Gtk.Button
                onClicked={() => {
                  if (isActive.get()) {
                    wifi.deactivate_connection()
                      .catch((e: Error) => print("deactivate failed:", e.message))
                    return
                  }
                  const conns = ap.get_connections()
                  const hasSaved = conns && conns.length > 0
                  if (ap.requires_password && !hasSaved) {
                    const entry = new Gtk.Entry({
                      placeholderText: "Password",
                      visibility: false,
                    })
                    setPasswordDialog({ ap, entry })
                    return
                  }
                  setConnectingAp(ap.bssid)
                  ap.activate()
                    .then(() => setConnectingAp(null))
                    .catch((e: Error) => {
                      print("activate failed:", e.message)
                      setConnectingAp(null)
                    })
                }}>
                <Gtk.Box spacing={8}>
                  <Gtk.Image
                    iconName={ap.iconName}
                    pixelSize={16}
                  />
                  <Gtk.Label
                    hexpand
                    halign={Gtk.Align.START}
                    label={ap.ssid ?? "Hidden Network"}
                  />
                  {isActive.as(active => active ?
                    <Gtk.Image
                      iconName="emblem-ok-symbolic"
                      pixelSize={16}
                    /> :
                    isConnecting.as(c => c ?
                      <Gtk.Spinner
                        spinning
                        marginEnd={4}
                      /> :
                      null)
                  )}
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
            setConnectingAp(ap.bssid)
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
          {wifiBinding.as(wifi =>
            wifi
              ? <WifiPopover wifi={wifi} />
              : <Gtk.Label
                  marginStart={12}
                  marginEnd={12}
                  marginTop={12}
                  marginBottom={12}
                  label="No WiFi device" />
          )}
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
