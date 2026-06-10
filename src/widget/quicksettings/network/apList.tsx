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
  strengthFraction,
  ApSnapshot,
  snapshotAp,
  findLiveAp,
} from "./utils"
import logger from "#/lib/logger"

interface ApListProps {
  wifi: Network.Wifi
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
}

// ── Helpers ────────────────────────────────────────────────────────

function sortAps(aps: ApSnapshot[], activeBssid: string | null): ApSnapshot[] {
  return [...aps].sort((a, b) => {
    // Active AP first
    const aActive = a.bssid !== null && activeBssid !== null && bssidEquals(a.bssid, activeBssid)
    const bActive = b.bssid !== null && activeBssid !== null && bssidEquals(b.bssid, activeBssid)
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1

    // Saved networks before new ones
    if (a.saved && !b.saved) return -1
    if (!a.saved && b.saved) return 1

    // Stronger signal first
    return b.strength - a.strength
  })
}

// ── AP Row ─────────────────────────────────────────────────────────

interface ApRowProps {
  snap: ApSnapshot
  wifi: Network.Wifi
  isActive: Accessor<boolean>
  isConnecting: Accessor<boolean>
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
}

function ApRow({
  snap,
  wifi,
  isActive,
  isConnecting,
  connectingAp,
  setConnectingAp,
}: ApRowProps) {
  const apSsid = snap.ssid
  const apBssid = snap.bssid
  const saved = snap.saved
  const secure = snap.secure
  const secLabel = snap.secLabel

  // Per-row password entry state
  const [showPassword, setShowPassword] = createState(false)
  const [passwordEntry, setPasswordEntry] = createState<Gtk.Entry | null>(null)
  const [passwordError, setPasswordError] = createState<string | null>(null)

  const doConnect = (password?: string) => {
    setPasswordError(null)
    if (apBssid) setConnectingAp(apBssid)
    const liveAp = findLiveAp(wifi, apBssid)
    if (!liveAp) {
      logger.error("network", "AP no longer available for connect")
      setConnectingAp(null)
      setPasswordError("Network no longer available")
      return
    }
    liveAp.activate(password ?? null)
      .then(() => {
        setConnectingAp(null)
        setShowPassword(false)
      })
      .catch((e: Error) => {
        logger.error("network", "activate failed:", e.message)
        setConnectingAp(null)
        setPasswordError(e.message || "Connection failed")
      })
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

  const savedNotActive = createComputed([isActive], (active) => saved && !active)

  return (
    <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Box spacing={0}>
        <Gtk.Button
          hexpand
          onClicked={() => {
            if (isActive.get()) {
              wifi
                .deactivate_connection()
                .catch((e: Error) =>
                  logger.error("network", "deactivate failed:", e.message),
                )
              return
            }

            // If secured and no saved connection → show password entry
            if (secure && !saved) {
              setShowPassword(!showPassword.get())
              return
            }

            // If saved or open → connect directly
            doConnect()
          }}
        >
          <Gtk.Box spacing={8}>
            {/* Lock icon for secured networks */}
            <Gtk.Image
              iconName={secure ? "network-wireless-encrypted-symbolic" : "network-wireless-signal-none-symbolic"}
              pixelSize={16}
            />

            {/* SSID + security label */}
            <Gtk.Box
              hexpand
              halign={Gtk.Align.START}
              orientation={Gtk.Orientation.VERTICAL}
              spacing={2}
            >
              <Gtk.Label
                hexpand
                halign={Gtk.Align.START}
                label={apSsid.replace(/&/g, "&amp;").replace(/</g, "&lt;")}
                ellipsize={3}
              />
              <Gtk.Label
                halign={Gtk.Align.START}
                label={secLabel}
                cssClasses={["dim-label", "caption"]}
              />
            </Gtk.Box>

            {/* Signal strength bars */}
            <Gtk.LevelBar
              valign={Gtk.Align.CENTER}
              value={strengthFraction(snap.strength)}
              widthRequest={40}
            />

            {/* Status: Active checkmark */}
            <Gtk.Image
              iconName="emblem-ok-symbolic"
              pixelSize={16}
              visible={isActive}
            />

            {/* Status: Saved badge */}
            <Gtk.Label
              label="Saved"
              cssClasses={["caption", "dim-label"]}
              valign={Gtk.Align.CENTER}
              visible={savedNotActive}
            />

            {/* Status: Connecting spinner */}
            <Gtk.Spinner
              spinning
              marginEnd={4}
              visible={isConnecting}
            />
          </Gtk.Box>
        </Gtk.Button>
        {/* Forget button (only for saved networks, not active) — outside main button */}
        <Gtk.Button
          visible={savedNotActive}
          cssClasses={["flat", "circular"]}
          onClicked={doForget}
          tooltipText="Forget Network"
        >
          <Gtk.Image iconName="user-trash-symbolic" pixelSize={14} />
        </Gtk.Button>
      </Gtk.Box>

      {/* Inline password entry — shown when clicking an unknown secured AP */}
      <Gtk.Revealer
        revealChild={showPassword}
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
      >
        <Gtk.Box
          spacing={4}
          marginStart={24}
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
              // Grab focus after widget is realized
              GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                self.grab_focus()
                return GLib.SOURCE_REMOVE
              })

              // Allow Enter to submit
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

      {/* Password error message */}
      <Gtk.Label
        label={passwordError.as((e) => e ?? "")}
        cssClasses={["error", "caption"]}
        marginStart={24}
        marginBottom={4}
        visible={passwordError.as((e) => e !== null)}
        wrap
      />
    </Gtk.Box>
  )
}

// ── AP List ────────────────────────────────────────────────────────

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
    <For each={sortedAps}>
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
            connectingAp={connectingAp}
            setConnectingAp={setConnectingAp}
          />
        )
      }}
    </For>
  )
}
