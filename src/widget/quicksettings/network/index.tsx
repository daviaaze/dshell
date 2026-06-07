import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, onMount, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import { wifiIconName } from "./utils"
import logger from "#/lib/logger"

export default () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()

  // Defer wifi binding to avoid NM synchronous D-Bus call during mount.
  // Accessing accessPoints triggers nm-access-point assertions and SEGV
  // on systems with corrupted NM AP data, so we never touch them.
  const [wifi, setWifi] = createState<Network.Wifi | null>(null)
  const [wifiReady, setWifiReady] = createState(false)

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      try {
        logger.log("Network: wifi binding")
        const wifiBinding = createBinding(network, "wifi")
        wifiBinding.subscribe(() => setWifi(wifiBinding.get()))
        setWifi(wifiBinding.get())
      } catch (e) {
        logger.error("network", "wifi binding failed:", e)
      }
      setWifiReady(true)
      return GLib.SOURCE_REMOVE
    })
  })

  const [connectingAp, setConnectingAp] = createState<string | null>(null)

  const isConnecting = connectingAp.as((connecting) => connecting !== null)

  const wifiIconName_ = createComputed(
    [wifi],
    (w) => {
      if (!w) return "network-wireless-offline-symbolic"
      return wifiIconName(w.strength, w.enabled, w.state)
    },
  )

  const wifiSsid = wifi.as((w) => w?.ssid ?? null)
  const wifiEnabled = wifi.as((w) => w?.enabled ?? false)

  const wifiCssClasses = createComputed(
    [wifi],
    (w) => {
      if (w?.state === Network.DeviceState.ACTIVATED) {
        return ["raised", "suggested-action"]
      }
      return ["raised"]
    },
  )

  // Minimal popover — no AP list, no scan, no active_access_point.
  // These all trigger nm-access-point assertions and SEGV on affected systems.
  const popover = (
    <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
      <LinkedPopoverBox>
        <With value={wifi}>
          {(w: Network.Wifi | null) =>
            w ? (
              <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                cssClasses={["popover-padded-lg"]}
              >
                <Gtk.Label
                  cssClasses={["title-3"]}
                  label={w.ssid ? `Connected to ${w.ssid}` : "Not connected"}
                  halign={Gtk.Align.START}
                />
                <Gtk.Label
                  cssClasses={["dim-label"]}
                  label={w.enabled ? "WiFi is on" : "WiFi is off"}
                  halign={Gtk.Align.START}
                />
                <Gtk.Button
                  hexpand
                  cssClasses={["raised"]}
                  onClicked={() => (w.enabled = !w.enabled)}
                  label={w.enabled ? "Turn WiFi Off" : "Turn WiFi On"}
                />
              </Gtk.Box>
            ) : (
              <Gtk.Label
                cssClasses={["popover-padded-lg"]}
                label={wifiReady.get() ? "No WiFi device" : "Loading…"}
              />
            )
          }
        </With>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      icon={createComputed([isConnecting, wifiIconName_], (connecting, icon) =>
        connecting ? "content-loading-symbolic" : icon,
      )}
      cssClasses={wifiCssClasses}
      label={wifiSsid.as((ssid) => {
        if (!ssid || ssid === "..." || ssid.trim() === "")
          return wifiEnabled.get() ? "WiFi" : "WiFi Off"
        return ssid.length > 24 ? ssid.slice(0, 24) + "…" : ssid
      })}
      onClick={() => {
        const w = wifi.get()
        if (!w) return
        w.enabled = !w.enabled
      }}
      popover={popover}
    />
  )
}
