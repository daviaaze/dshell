import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
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

function doConnect(
  ap: Network.AccessPoint,
  entry: Gtk.Entry,
  setPasswordDialog: (v: null) => void,
  setConnectingAp: (v: string | null) => void,
) {
  const pw = entry.get_text()
  setPasswordDialog(null)
  const bssid = bssidOf(ap)
  if (bssid) setConnectingAp(bssid)
  ap.activate(pw)
    .then(() => setConnectingAp(null))
    .catch((e: Error) => {
      logger.error("network", "activate with password failed:", e)
      setConnectingAp(null)
    })
}

export default ({
  passwordDialog,
  setPasswordDialog,
  setConnectingAp,
}: PasswordDialogProps) => {
  const dialog = passwordDialog.get()
  if (!dialog) return null

  const { ap, entry } = dialog
  entry.hexpand = true
  entry.placeholderText = "Password"

  // Focus the entry on reveal so the user can type immediately
  entry.grab_focus()

  // Allow Enter to submit
  const controller = new Gtk.EventControllerKey()
  controller.connect("key-pressed", (_ctrl, keyval) => {
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
      doConnect(ap, entry, setPasswordDialog, setConnectingAp)
      return true
    }
    return false
  })
  entry.add_controller(controller)

  return (
    <Gtk.Revealer revealChild={passwordDialog.as((d) => d !== null)}>
      <Gtk.Box spacing={4}>
        {entry}
        <Gtk.Button
          cssClasses={["suggested-action"]}
          onClicked={() =>
            doConnect(ap, entry, setPasswordDialog, setConnectingAp)
          }
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
