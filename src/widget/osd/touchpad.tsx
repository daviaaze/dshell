import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import Touchpad from "#/lib/touchpad"

export default () => {
  const touchpad = Touchpad.get_default()

  return (
    <Gtk.Box spacing={8}>
      <Gtk.Image
        iconName={createBinding(touchpad, "enabled").as((enabled) =>
          enabled ? "input-touchpad-symbolic" : "touchpad-disabled-symbolic",
        )}
        pixelSize={20}
      />
      <Gtk.Label
        hexpand
        cssClasses={["heading"]}
        label={createBinding(touchpad, "enabled").as((enabled) =>
          enabled ? "Touchpad On" : "Touchpad Off",
        )}
      />
    </Gtk.Box>
  )
}
