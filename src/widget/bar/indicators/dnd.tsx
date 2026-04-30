import Notifd from "gi://AstalNotifd"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () =>
  <Gtk.Image
    visible={createBinding(Notifd.get_default(), "dontDisturb")}
    iconName="notifications-disabled-symbolic"
    pixelSize={18} />
