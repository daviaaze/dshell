import Gtk from "gi://Gtk?version=4.0"
import { createState, onMount } from "gnim"
import PowerProfiles from "#/lib/powerProfiles"

export default () => {
  const [visible, setVisible] = createState(false)
  const [iconName, setIconName] = createState("")
  const [tooltip, setTooltip] = createState("")
  const pp = PowerProfiles.get_default()

  onMount(() => {
    const update = () => {
      const p = pp.activeProfile
      setVisible(p !== "balanced")
      setIconName(pp.iconName)
      setTooltip(p)
    }
    pp.connect("notify::activeProfile", update)
    update()
  })

  return (
    <Gtk.Image
      visible={visible}
      iconName={iconName}
      tooltipMarkup={tooltip}
      pixelSize={18}
    />
  )
}