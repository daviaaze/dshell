import Network from "gi://AstalNetwork"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createState, For } from "gnim"

const network = Network.get_default()

export default () => {
  const wifi = network.wifi

  const [connectingAp, setConnectingAp] = createState<string | null>(null)
  const [passwordDialog, setPasswordDialog] = createState<{
    ap: Network.AccessPoint,
    entry: Gtk.Entry
  } | null>(null)

  const WifiPopover = () => {
    if (!wifi) return <Gtk.Label label="No WiFi device found" />

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
          <For each={createBinding(wifi, "accessPoints")}>
            {(ap: Network.AccessPoint) => {
              const isActive = createBinding(wifi, "activeAccessPoint")
                .as(active => active?.bssid === ap.bssid)
              const isConnecting = connectingAp.as(c => c === ap.bssid)

              return <Gtk.Button
                onClicked={() => {
                  if (isActive.get()) {
                    wifi.deactivate_connection().catch(() => {})
                    return
                  }
                  if (ap.requires_password && ap.get_connections().length === 0) {
                    const entry = new Gtk.Entry({
                      placeholderText: "Password",
                      visibility: false,
                    })
                    setPasswordDialog({ ap, entry })
                    return
                  }
                  setConnectingAp(ap.bssid)
                  ap.activate().then(() => {
                    setConnectingAp(null)
                  }).catch(() => {
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
            ap.activate(pw).then(() => {
              setConnectingAp(null)
            }).catch(() => {
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

  if (!wifi) {
    return <Adw.SplitButton
      cssClasses={["raised"]}
      widthRequest={150}
      popover={
        <Gtk.Popover cssClasses={[]}>
          <Gtk.Label
            marginStart={12}
            marginEnd={12}
            marginTop={12}
            marginBottom={12}
            label="No WiFi device"
          />
        </Gtk.Popover> as Gtk.Popover}>
      <Adw.ButtonContent
        iconName="network-wireless-offline-symbolic"
        label="No WiFi" />
    </Adw.SplitButton>
  }

  return <Adw.SplitButton
    cssClasses={["raised"]}
    widthRequest={150}
    $={self => {
      self.connect("clicked", () => {
        if (wifi.state === Network.DeviceState.ACTIVATED) {
          wifi.deactivate_connection().catch(() => {})
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
          <WifiPopover />
          <PasswordDialog />
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}>
    <Adw.ButtonContent
      iconName={createBinding(wifi, "iconName")}
      label={createBinding(wifi, "ssid").as(ssid =>
        ssid ?? (wifi.enabled ? "WiFi" : "WiFi Off")
      )} />
  </Adw.SplitButton>
}
