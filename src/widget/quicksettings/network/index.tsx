import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, onMount, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import { wifiIconName } from "./utils"
import logger from "#/lib/logger"
import WifiPopover from "./wifiPopover"

export default () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()

  // Defer wifi binding creation to avoid NM synchronous D-Bus call
  // during mount, which triggers ~100+ nm-access-point assertions and
  // can cause a SEGV (memory corruption) on systems with bad AP data.
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

  // Blue "suggested-action" when connected (matching Bluetooth pattern)
  const wifiCssClasses = createComputed(
    [wifi],
    (w) => {
      if (w?.state === Network.DeviceState.ACTIVATED) {
        return ["raised", "suggested-action"]
      }
      return ["raised"]
    },
  )

  const popover = (
    <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
      <LinkedPopoverBox>
        <With value={wifi}>
          {(w: Network.Wifi | null) =>
            w ? (
              <WifiPopover
                wifi={w}
                connectingAp={connectingAp}
                setConnectingAp={setConnectingAp}
              />
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
        if (w.state === Network.DeviceState.ACTIVATED) {
          const activeAp = w.active_access_point
          if (activeAp) {
            w
              .deactivate_connection(activeAp)
              .catch((e: Error) =>
                logger.error("network", "deactivate failed:", e.message),
              )
          }
        } else {
          w.enabled = !w.enabled
        }
      }}
      popover={popover}
    />
  )
}
