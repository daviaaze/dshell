import Gtk from "gi://Gtk?version=4.0"
import PowerProf from "gi://AstalPowerProfiles"
import { createBinding } from "gnim"
import logger from "#/lib/logger"

export default () => {
  logger.log("PowerIndicator: PowerProf.get_default()...")
  const powerprof = PowerProf.get_default()
  logger.log("PowerIndicator: PowerProf done")

  return <Gtk.Image
    visible={createBinding(powerprof, "activeProfile")
      .as(p => p !== "balanced")}
    iconName={createBinding(powerprof, "iconName").as(i => i ?? "")}
    tooltipMarkup={createBinding(powerprof, "activeProfile")
      .as(p => p ?? "")}
    pixelSize={18} />
}
