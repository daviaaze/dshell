import AstalHyprland from "gi://AstalHyprland?version=0.1"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { Accessor, createBinding, createComputed } from "gnim"
import { getAppIcon } from "#/lib/apps"

const hyprland = AstalHyprland.get_default()

export default ({
  visible: settingsVisible,
}: {
  visible: Accessor<boolean>
}) => {
  const client = createBinding(hyprland, "focusedClient")

  const title = client.as((c) => {
    if (!c || c.address === "0x0") return ""
    return c.title || c.class || ""
  })

  const appIcon = client.as((c) => {
    if (!c || c.address === "0x0") return ""
    return getAppIcon(c)
  })

  const clientExists = client.as((c) => c && c.address !== "0x0")

  // Only visible when both settings say "show" AND a client exists
  const visible = createComputed(() => settingsVisible() && clientExists())

  return (
    <Gtk.Box
      visible={visible}
      spacing={8}
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}
      cssClasses={["linked"]}
    >
      <Gtk.Image visible={visible} iconName={appIcon} pixelSize={16} />
      <Gtk.Label
        visible={visible}
        label={title}
        maxWidthChars={40}
        ellipsize={Pango.EllipsizeMode.END}
        tooltipMarkup={title}
      />
    </Gtk.Box>
  )
}
