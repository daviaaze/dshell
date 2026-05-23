import Network from "gi://AstalNetwork"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, Accessor, For, With } from "gnim"
import { toArray, listLength } from "#/lib/gjsUtils"
import { ssidOf, bssidOf, bssidEquals } from "./utils"
import logger from "#/lib/logger"

interface ApListProps {
  wifi: Network.Wifi
  connectingAp: Accessor<string | null>
  setConnectingAp: (v: string | null) => void
  setPasswordDialog: (
    v: { ap: Network.AccessPoint; entry: Gtk.Entry } | null,
  ) => void
}

export default ({
  wifi,
  connectingAp,
  setConnectingAp,
  setPasswordDialog,
}: ApListProps) => {
  const aps = createBinding(wifi, "accessPoints").as((points) =>
    toArray<Network.AccessPoint>(points),
  )

  return (
    <For each={aps}>
      {(ap: Network.AccessPoint) => {
        const apSsid = ssidOf(ap)
        const apBssid = bssidOf(ap)

        const isActive = createBinding(wifi, "activeAccessPoint").as(
          (active) => {
            if (!active || !apBssid) return false
            return bssidEquals(active.bssid, ap.bssid)
          },
        )

        const isConnecting = connectingAp.as(
          (c) => apBssid !== null && c !== null && bssidEquals(c, ap.bssid),
        )

        const apStatus = createComputed(
          [isActive, isConnecting],
          (active, connecting) => {
            if (active) return "active"
            if (connecting) return "connecting"
            return "idle"
          },
        )

        return (
          <Gtk.Button
            onClicked={() => {
              if (isActive.get()) {
                wifi
                  .deactivate_connection()
                  .catch((e: Error) =>
                    logger.error("network", "deactivate failed:", e.message),
                  )
                return
              }
              const conns = ap.get_connections()
              const hasSaved = listLength(conns) > 0
              if (ap.requires_password && !hasSaved) {
                const entry = new Gtk.Entry({ placeholderText: "Password" })
                entry.set_visibility(false)
                setPasswordDialog({ ap, entry })
                return
              }
              if (apBssid) setConnectingAp(apBssid)
              ap.activate()
                .then(() => setConnectingAp(null))
                .catch((e: Error) => {
                  logger.error("network", "activate failed:", e.message)
                  setConnectingAp(null)
                })
            }}
          >
            <Gtk.Box spacing={8}>
              <Gtk.Image
                iconName={
                  typeof ap.iconName === "string"
                    ? ap.iconName
                    : "network-wireless-symbolic"
                }
                pixelSize={16}
              />
              <Gtk.Label hexpand halign={Gtk.Align.START} label={apSsid} ellipsize={3} />
              <With value={apStatus}>
                {(status: "active" | "connecting" | "idle") => {
                  if (status === "active")
                    return (
                      <Gtk.Image iconName="emblem-ok-symbolic" pixelSize={16} />
                    )
                  if (status === "connecting")
                    return <Gtk.Spinner spinning marginEnd={4} />
                  return null
                }}
              </With>
            </Gtk.Box>
          </Gtk.Button>
        )
      }}
    </For>
  )
}
