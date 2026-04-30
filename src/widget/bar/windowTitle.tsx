import AstalHyprland from "gi://AstalHyprland?version=0.1"
import Apps from "gi://AstalApps"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createBinding } from "gnim"

const hyprland = AstalHyprland.get_default()
const apps = new Apps.Apps()

export default () => {
  const client = createBinding(hyprland, "focusedClient")

  const title = client.as(c => {
    if (!c || c.address === "0x0") return ""
    return c.title || c.class || ""
  })

  const appIcon = client.as(c => {
    if (!c || c.address === "0x0") return ""
    const app = apps.fuzzy_query(c.class)?.[0]
    return app?.iconName || "application-x-executable-symbolic"
  })

  const visible = client.as(c => c && c.address !== "0x0")

  return <Gtk.Box
    visible={visible}
    spacing={8}
    valign={Gtk.Align.CENTER}
    halign={Gtk.Align.CENTER}
    cssClasses={["linked"]}>
    <Gtk.Image
      visible={visible}
      iconName={appIcon}
      pixelSize={16}
    />
    <Gtk.Label
      visible={visible}
      label={title}
      maxWidthChars={40}
      ellipsize={Pango.EllipsizeMode.END}
      tooltipMarkup={title}
    />
  </Gtk.Box>
}
