import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import Screenshot from "#/lib/screenshot"

export default () => (
  <Gtk.Image
    visible={createBinding(Screenshot.get_default(), "recording")}
    iconName="media-record-symbolic"
    cssClasses={["error"]}
    pixelSize={18}
  />
)
