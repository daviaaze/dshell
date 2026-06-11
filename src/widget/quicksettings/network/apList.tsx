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

  const doConnect = (password?: string) => {
    setPasswordError(null)
    const liveAp = findLiveAp(wifi, apBssid)
    if (!liveAp) {
      logger.error("network", "AP no longer available for connect")
      setConnectingAp(null)
      setPasswordError("Network no longer available")
      return
    }

    if (!secure) {
      if (apBssid) setConnectingAp(apBssid)
      liveAp.activate(null)
        .then(() => {
          setConnectingAp(null)
          setShowPassword(false)
        })
        .catch((e: Error) => {
          logger.error("network", "activate failed:", e.message)
          setConnectingAp(null)
          setPasswordError(e.message || "Connection failed")
        })
      return
    }

    if (password !== undefined) {
      if (apBssid) setConnectingAp(apBssid)
      liveAp.activate(password || null)
        .then(() => {
          setConnectingAp(null)
          setShowPassword(false)
        })
        .catch((e: Error) => {
          logger.error("network", "activate failed:", e.message)
          setConnectingAp(null)
          setPasswordError(e.message || "Connection failed")
        })
      return
    }

    try {
      if (isSaved(liveAp)) {
        if (apBssid) setConnectingAp(apBssid)
        liveAp.activate(null)
          .then(() => {
            setConnectingAp(null)
            setShowPassword(false)
          })
          .catch((e: Error) => {
            logger.error("network", "activate failed:", e.message)
            setConnectingAp(null)
            setPasswordError(e.message || "Connection failed")
          })
      } else {
        setConnectingAp(null)
        setShowPassword(!showPassword.get())
      }
    } catch (e) {
      logger.error("network", "saved check failed:", e)
      setConnectingAp(null)
      setShowPassword(!showPassword.get())
    }
  }

  const doForget = () => {
    const liveAp = findLiveAp(wifi, apBssid)
    if (!liveAp) {
      logger.error("network", "AP no longer available for forget")
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

  const notActive = createComputed([isActive], (active) => !active)

  const canForget = createComputed([isActive], (active) => {
    if (active) return false
    const liveAp = findLiveAp(wifi, apBssid)
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
            if (isActive.get()) {
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
              const entry = passwordEntry.get()
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

          const isActive = createComputed([activeBssid], (active) => {
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
