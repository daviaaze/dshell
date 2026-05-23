import Notifd from "gi://AstalNotifd"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"

export default () => {
  const [visible, setVisible] = createState(false)

  onMount(() => {
    // Defer Notifd initialization — AstalNotifd blocks 25s if another
    // notification daemon (dunst, mako) is already registered.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const notifd = Notifd.get_default()
      setVisible(notifd.dontDisturb)
      notifd.connect("notify::dontDisturb", () => {
        setVisible(notifd.dontDisturb)
      })
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName="notifications-disabled-symbolic"
      pixelSize={18}
    />
  )
}
