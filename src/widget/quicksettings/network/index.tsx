import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, onMount, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import WifiPopover from "./wifiPopover"
import { wifiIconName } from "./utils"
import logger from "#/lib/logger"

interface WifiWrap {
  wifi: Network.Wifi | null
  tick: number
}

export default () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()

  const [wifiWrap, setWifiWrap] = createState<WifiWrap>({ wifi: null, tick: 0 })
  const [wifiDevice, setWifiDevice] = createState<Network.Wifi | null>(null)
  const [wifiReady, setWifiReady] = createState(false)
  const wifi = wifiWrap.as((w) => w.wifi)

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      let wifiSignalIds: number[] = []

      const cleanupWifiSignals = () => {
        const w = network.wifi
        for (const id of wifiSignalIds) {
          if (w) w.disconnect(id)
        }
        wifiSignalIds = []
      }

      const onWifiPropertyChanged = () => {
        setWifiWrap((prev) => ({ wifi: network.wifi, tick: prev.tick + 1 }))
      }

      const onWifiDeviceChanged = () => {
        cleanupWifiSignals()
        const w = network.wifi
        setWifiWrap((prev) => ({ wifi: w, tick: prev.tick + 1 }))
        if (w !== wifiDevice.get()) {
          setWifiDevice(w)
        }
        if (w) {
          wifiSignalIds.push(w.connect("notify::state", onWifiPropertyChanged))
          wifiSignalIds.push(w.connect("notify::strength", onWifiPropertyChanged))
          wifiSignalIds.push(w.connect("notify::ssid", onWifiPropertyChanged))
          wifiSignalIds.push(w.connect("notify::enabled", onWifiPropertyChanged))
        }
      }

      try {
        logger.log("Network: wifi binding")
        const wifiBinding = createBinding(network, "wifi")
        wifiBinding.subscribe(onWifiDeviceChanged)
        onWifiDeviceChanged()
      } catch (e) {
        logger.error("network", "wifi binding failed:", e)
      }
      setWifiReady(true)
      return GLib.SOURCE_REMOVE
    })
  })

  const [connectingAp, setConnectingAp] = createState<string | null>(null)
  const isConnecting = connectingAp.as((c) => c !== null)

  const wifiIconName_ = createComputed(
    [wifiWrap],
    (wrap) => {
      const w = wrap.wifi
      if (!w) return "network-wireless-offline-symbolic"
      return wifiIconName(w.strength, w.enabled, w.state)
    },
  )

  const wifiSsid = wifiWrap.as((wrap) => wrap.wifi?.ssid ?? null)
  const wifiEnabled = wifiWrap.as((wrap) => wrap.wifi?.enabled ?? false)

  const wifiCssClasses = createComputed(
    [wifiWrap],
    (wrap) => {
      if (wrap.wifi?.state === Network.DeviceState.ACTIVATED) {
        return ["raised", "suggested-action"]
      }
      return ["raised"]
    },
  )

  const label = createComputed(
    [wifiSsid, wifiEnabled],
    (ssid, enabled) => {
      if (!ssid || ssid === "..." || ssid.trim() === "")
        return enabled ? "WiFi" : "WiFi Off"
      return ssid.length > 24 ? ssid.slice(0, 24) + "…" : ssid
    },
  )

  const popover = (
    <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
      <LinkedPopoverBox>
        <With value={wifiDevice}>
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
      label={label}
      onClick={() => {
        const w = wifi.get()
        if (!w) return
        w.enabled = !w.enabled
      }}
      popover={popover}
    />
  )
}
