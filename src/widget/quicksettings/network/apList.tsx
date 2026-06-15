import Network from "gi://AstalNetwork"
import NM from "gi://NM?version=1.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createBinding, createComputed, createState, Accessor, For } from "gnim"
import { toArray } from "#/lib/gjsUtils"
import {
  bssidOf,
  bssidEquals,
  ApSnapshot,
  snapshotAp,
  findLiveAp,
  isSaved,
  signalIconName,
  escapeLabel,
} from "./utils"
import logger from "#/lib/logger"

interface ApListProps {
  wifi: Network.Wifi
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
}

function sortAps(aps: ApSnapshot[], activeBssid: string | null): ApSnapshot[] {
  return [...aps].sort((a, b) => {
    const aActive = a.bssid !== null && activeBssid !== null && bssidEquals(a.bssid, activeBssid)
    const bActive = b.bssid !== null && activeBssid !== null && bssidEquals(b.bssid, activeBssid)
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    return b.strength - a.strength
  })
}

interface ApRowProps {
  snap: ApSnapshot
  wifi: Network.Wifi
  isActive: Accessor<boolean>
  isConnecting: Accessor<boolean>
  setConnectingAp: (v: string | null) => void
}

function ApRow({
  snap,
  wifi,
  isActive,
  isConnecting,
  setConnectingAp,
}: ApRowProps) {
  const apSsid = snap.ssid
  const apBssid = snap.bssid
  const secure = snap.secure
  const secLabel = snap.secLabel

  const [showPassword, setShowPassword] = createState(false)
  const [passwordEntry, setPasswordEntry] = createState<Gtk.Entry | null>(null)
  const [passwordError, setPasswordError] = createState<string | null>(null)
  let lastConnectMs = 0
  const CONNECT_DEBOUNCE_MS = 1500

  /**
   * Fallback: connect via NM client directly when the live AP object
   * went stale between list render and user click. This happens during
   * scan cycles where AstalNetwork invalidates old AP objects.
   */
  async function connectViaNM(password?: string): Promise<void> {
    if (!apSsid || apSsid === "Hidden Network")
      throw new Error("Network not found")

    const network = Network.get_default()
    const client = network.client as NM.Client
    if (!wifi.device) throw new Error("No WiFi device")

    const connection = new NM.SimpleConnection()

    const sCon = new NM.SettingConnection()
    sCon.type = "802-11-wireless"
    sCon.uuid = GLib.uuid_string_random() ?? undefined
    sCon.id = apSsid
    connection.add_setting(sCon)

    const sWifi = new NM.SettingWireless()
    sWifi.ssid = new GLib.Bytes(new TextEncoder().encode(apSsid)) as any
    sWifi.mode = "infrastructure"
    connection.add_setting(sWifi)

    if (secure && password !== undefined) {
      const sSec = new NM.SettingWirelessSecurity()
      sSec.key_mgmt = "wpa-psk"
      sSec.psk = password
      connection.add_setting(sSec)
    }

    return new Promise((resolve, reject) => {
      client.add_and_activate_connection_async(
        connection,
        wifi.device,
        null,
        null,
        (_source: any, res: any) => {
          try {
            client.add_and_activate_connection_finish(res)
            resolve()
          } catch (e) {
            reject(e)
          }
        },
      )
    })
  }

  const doConnect = (password?: string) => {
    // Time-based debounce: rapid re-triggers from Gnim reconciliation
    // during scan cycles re-fire the onClicked handler on fresh closures.
    const now = Date.now()
    if (now - lastConnectMs < CONNECT_DEBOUNCE_MS) return
    lastConnectMs = now

    setPasswordError(null)

    const run = async () => {
      const liveAp = findLiveAp(wifi, apBssid, apSsid)

      if (liveAp) {
        if (apBssid) setConnectingAp(apBssid)

        if (!secure) {
          await liveAp.activate(null)
        } else if (password !== undefined) {
          await liveAp.activate(password || null)
        } else if (isSaved(liveAp)) {
          await liveAp.activate(null)
        } else {
          // Not saved and no password — show the password entry
          setShowPassword(!showPassword())
          return
        }

        setShowPassword(false)
        return
      }

      // Live AP went stale — fall back to NM direct connection
      if (!apSsid || apSsid === "Hidden Network") {
        throw new Error("Network no longer available")
      }

      if (apBssid) setConnectingAp(apBssid)
      await connectViaNM(password)
      setShowPassword(false)
    }

    run()
      .then(() => {
        setConnectingAp(null)
      })
      .catch((e: Error) => {
        setConnectingAp(null)
        logger.warn("network", "connect failed:", e.message)
        setPasswordError(e.message || "Connection failed")
      })
  }

  const doForget = () => {
    const liveAp = findLiveAp(wifi, apBssid, apSsid)
    if (!liveAp) {
      logger.warn("network", "AP no longer available for forget")
      return
    }
    try {
      const conns = liveAp.get_connections()
      if (!conns) return
      const arr = toArray<NM.RemoteConnection>(conns)
      for (const conn of arr) {
        conn.delete_async(null, (_source: any, res: any) => {
          try {
            conn.delete_finish(res)
          } catch (e: any) {
            logger.error("network", "forget failed:", e.message)
          }
        })
      }
    } catch (e) {
      logger.error("network", "forget error:", e)
    }
  }

  const notActive = createComputed(() => !isActive())

  const canForget = createComputed(() => {
    if (isActive()) return false
    const liveAp = findLiveAp(wifi, apBssid, apSsid)
    if (!liveAp) return false
    return isSaved(liveAp)
  })

  const prefixIcon = secure
    ? "network-wireless-encrypted-symbolic"
    : signalIconName(snap.strength)

  return (
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={0}>
        <Gtk.Button
          hexpand
          cssClasses={["flat"]}
          onClicked={() => {
            if (isActive()) {
              wifi
                .deactivate_connection(null)
                .catch((e: Error) =>
                  logger.error("network", "deactivate failed:", e.message),
                )
              return
            }
            doConnect()
          }}
        >
          <Gtk.Box spacing={12}>
            <Gtk.Image
              iconName={prefixIcon}
              pixelSize={16}
            />

            <Gtk.Box
              hexpand
              halign={Gtk.Align.FILL}
              orientation={Gtk.Orientation.VERTICAL}
              spacing={2}
            >
              <Gtk.Label
                hexpand
                halign={Gtk.Align.FILL}
                label={escapeLabel(apSsid)}
                ellipsize={3}
              />
              <Gtk.Label
                halign={Gtk.Align.START}
                label={secLabel}
                cssClasses={["dim-label", "caption"]}
              />
            </Gtk.Box>

            <Gtk.Image
              iconName={signalIconName(snap.strength)}
              pixelSize={16}
              valign={Gtk.Align.CENTER}
              visible={secure}
              tooltipText={`${snap.strength}%`}
            />
            <Gtk.Image
              iconName={signalIconName(snap.strength)}
              pixelSize={16}
              valign={Gtk.Align.CENTER}
              visible={notActive.as((na) => na && !secure)}
              tooltipText={`${snap.strength}%`}
            />

            <Gtk.Image
              iconName="emblem-ok-symbolic"
              pixelSize={16}
              visible={isActive}
            />

            <Gtk.Spinner
              spinning
              visible={isConnecting}
            />
          </Gtk.Box>
        </Gtk.Button>

        <Gtk.Button
          visible={canForget}
          cssClasses={["flat", "circular"]}
          onClicked={doForget}
          tooltipText="Forget Network"
          valign={Gtk.Align.CENTER}
        >
          <Gtk.Image iconName="user-trash-symbolic" pixelSize={14} />
        </Gtk.Button>
      </Gtk.Box>

      <Gtk.Revealer
        revealChild={showPassword}
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
      >
        <Gtk.Box
          spacing={4}
          marginStart={28}
          marginEnd={4}
          marginTop={4}
          marginBottom={4}
        >
          <Gtk.Entry
            placeholderText="Password"
            visibility={false}
            hexpand
            $={(self) => {
              setPasswordEntry(self)
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                self.grab_focus()
                return GLib.SOURCE_REMOVE
              })

              const controller = new Gtk.EventControllerKey()
              controller.connect("key-pressed", (_ctrl, keyval) => {
                if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
                  doConnect(self.get_text() || undefined)
                  return true
                }
                return false
              })
              self.add_controller(controller)
            }}
          />
          <Gtk.Button
            cssClasses={["suggested-action"]}
            onClicked={() => {
              const entry = passwordEntry()
              doConnect(entry?.get_text() || undefined)
            }}
          >
            <Gtk.Image iconName="go-next-symbolic" />
          </Gtk.Button>
          <Gtk.Button onClicked={() => setShowPassword(false)}>
            <Gtk.Image iconName="window-close-symbolic" />
          </Gtk.Button>
        </Gtk.Box>
      </Gtk.Revealer>

      <Gtk.Label
        label={passwordError.as((e) => e ?? "")}
        cssClasses={["error", "caption"]}
        marginStart={28}
        marginBottom={4}
        visible={passwordError.as((e) => e !== null)}
        wrap
      />
    </Gtk.Box>
  )
}

export default ({
  wifi,
  connectingAp,
  setConnectingAp,
}: ApListProps) => {
  const activeBssid = createBinding(wifi, "activeAccessPoint").as((active) => {
    if (!active) return null
    return bssidOf(active)
  })

  const sortedAps = createComputed(
    [createBinding(wifi, "accessPoints"), activeBssid],
    (points, active) => {
      const list = toArray<Network.AccessPoint>(points)
      const snaps = list.map(snapshotAp)
      return sortAps(snaps, active)
    },
  )

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={0}
      hexpand
      cssClasses={["network-list"]}
    >
      <For each={sortedAps} id={(snap) => snap.bssid ?? snap.ssid}>
        {(snap: ApSnapshot) => {
          const apBssid = snap.bssid

          const isActive = createComputed(() => {
            const active = activeBssid()
            if (!apBssid || !active) return false
            return bssidEquals(apBssid, active)
          })

          const isConnecting = connectingAp.as(
            (c) => apBssid !== null && c !== null && bssidEquals(c, apBssid),
          )

          return (
            <ApRow
              snap={snap}
              wifi={wifi}
              isActive={isActive}
              isConnecting={isConnecting}
              setConnectingAp={setConnectingAp}
            />
          )
        }}
      </For>
    </Gtk.Box>
  )
}
