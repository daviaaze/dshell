import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, onMount, onCleanup, With } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedBox } from "#/widget/common/linkedBox"
import WifiPopover from "./wifiPopover"
import { wifiIconName } from "./utils"
import logger from "#/lib/logger"

interface WifiWrap {
  wifi: Network.Wifi | null
  tick: number
}

const WifiQuicksettingsButton = () => {
  logger.log("Network: get_default()")
  const network = Network.get_default()

  const [wifiWrap, setWifiWrap] = createState<WifiWrap>({ wifi: null, tick: 0 })
  const [wifiDevice, setWifiDevice] = createState<Network.Wifi | null>(null)
  const [wifiReady, setWifiReady] = createState(false)

  onMount(() => {
    let wifiSignalIds: number[] = []
    let unsubWifi: (() => void) | null = null

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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
        if (w !== wifiDevice()) {
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
        unsubWifi = wifiBinding.subscribe(onWifiDeviceChanged)
        onWifiDeviceChanged()
      } catch (e) {
        logger.error("network", "wifi binding failed:", e)
      }
      setWifiReady(true)
      return GLib.SOURCE_REMOVE
    })
    onCleanup(() => {
      // Disconnect wifi device-level signals
      const w = network.wifi
      for (const id of wifiSignalIds) {
        try { if (w) w.disconnect(id) } catch { /* already dead */ }
      }
      // Unsubscribe wifi binding
      if (unsubWifi) unsubWifi()
      wifiSignalIds = []
    })
  })

  const [connectingAp, setConnectingAp] = createState<string | null>(null)

  const wifiIconName_ = createComputed(
    () => {
      const wifi = wifiWrap().wifi

      if (!wifi) return "network-wireless-offline-symbolic"
      return wifiIconName(wifi.strength, wifi.enabled, wifi.state)
    },
  )

  const icon = createComputed(() => {
    const isConnecting = connectingAp()

    return isConnecting ? "content-loading-symbolic" : wifiIconName_()
  }
  )

  const wifiCssClasses = createComputed(
    () => {
      const wifi = wifiWrap().wifi

      if (wifi?.state === Network.DeviceState.ACTIVATED) {
        return ["raised", "suggested-action"]
      }
      return ["raised"]
    },
  )

  const wifiSsid = wifiWrap.as((wrap) => wrap.wifi?.ssid ?? null)
  const wifiEnabled = wifiWrap.as((wrap) => wrap.wifi?.enabled ?? false)



  const label = createComputed(
    () => {
      const ssid = wifiSsid();
      const enabled = wifiEnabled();

      if (!ssid || ssid === "..." || ssid.trim() === "")
        return enabled ? "WiFi" : "WiFi Off"
      return ssid.length > 24 ? ssid.slice(0, 24) + "…" : ssid
    },
  )

  const popover = (
    <Gtk.Popover cssClasses={[]} position={Gtk.PositionType.LEFT}>
      <LinkedBox>
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
                label={wifiReady() ? "No WiFi device" : "Loading…"}
              />
            )
          }
        </With>
      </LinkedBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      icon={icon}
      visible={wifiWrap.as(wifi => !!wifi.wifi)}
      cssClasses={wifiCssClasses}
      label={label}
      onClick={() => {
        const wifi = wifiWrap().wifi
        if (wifi === null) return false
        wifi.enabled = !wifi.enabled
        return true
      }}
      popover={popover}
    />
  )
}

export default WifiQuicksettingsButton;