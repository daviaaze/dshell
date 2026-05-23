import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import KeyboardLayout from "#/lib/keyboard"

export default () => {
  const keyboard = KeyboardLayout.get_default()

  return (
    <Gtk.Button
      visible={createBinding(keyboard, "available")}
      cssClasses={["flat"]}
      onClicked={() => keyboard.cycle()}
      tooltipMarkup={createBinding(keyboard, "layout").as(
        (l) => `Keyboard layout: ${l}\nClick to cycle`,
      )}
    >
      <Gtk.Label
        cssClasses={["heading", "numeric"]}
        label={createBinding(keyboard, "layout")}
      />
    </Gtk.Button>
  )
}
