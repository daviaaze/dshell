import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import Inhibit from "#/lib/inhibit"

export default () => {
  const inhibit = Inhibit.get_default()

  const tooltip = createComputed(
    [createBinding(inhibit, "idle"), createBinding(inhibit, "remaining")],
    (idle, remaining) => {
      if (!idle) return ""
      return remaining ? `Keep Awake — ${remaining} remaining` : "Keep Awake"
    },
  )

  return (
    <Gtk.Image
      visible={createBinding(inhibit, "idle")}
      iconName="weather-clear-symbolic"
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}
