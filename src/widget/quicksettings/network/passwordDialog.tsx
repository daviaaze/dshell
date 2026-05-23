import Gtk from "gi://Gtk?version=4.0"
import { Accessor } from "gnim"
import Network from "gi://AstalNetwork"
import { bssidOf } from "./utils"
import logger from "#/lib/logger"

interface PasswordDialogProps {
  passwordDialog: Accessor<{ ap: Network.AccessPoint; entry: Gtk.Entry } | null>
  setPasswordDialog: (
    v: { ap: Network.AccessPoint; entry: Gtk.Entry } | null,
  ) => void
  setConnectingAp: (v: string | null) => void
}

export default ({
  passwordDialog,
  setPasswordDialog,
  setConnectingAp,
}: PasswordDialogProps) => {
  const dialog = passwordDialog.get()
  if (!dialog) return null

  return (
    <Gtk.Revealer revealChild={passwordDialog.as((d) => d !== null)}>
      <Gtk.Box spacing={4}>
        {dialog.entry}
        <Gtk.Button
          cssClasses={["suggested-action"]}
          onClicked={() => {
            const pw = dialog.entry.get_text()
            const ap = dialog.ap
            setPasswordDialog(null)
            const bssid = bssidOf(ap)
            if (bssid) setConnectingAp(bssid)
            ap.activate(pw)
              .then(() => setConnectingAp(null))
              .catch((e: Error) => {
                logger.error("network", "activate with password failed:", e)
                setConnectingAp(null)
              })
          }}
        >
          <Gtk.Image iconName="go-next-symbolic" />
        </Gtk.Button>
        <Gtk.Button onClicked={() => setPasswordDialog(null)}>
          <Gtk.Image iconName="window-close-symbolic" />
        </Gtk.Button>
      </Gtk.Box>
    </Gtk.Revealer>
  )
}
