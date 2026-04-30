import Gtk from "gi://Gtk?version=4.0"
import PowerProf from "gi://AstalPowerProfiles"
import { createBinding } from "gnim"
import AutoCpufreq, { iconForProfile } from "#/lib/autoCpufreq"

export default () => {
  const autoCpufreq = AutoCpufreq.get_default()
  const powerprof = PowerProf.get_default()

  if (autoCpufreq.available) {
    return <Gtk.Image
      visible={createBinding(autoCpufreq, "activeProfile")
        .as(p => p !== "balanced")}
      iconName={createBinding(autoCpufreq, "activeProfile").as(iconForProfile)}
      tooltipMarkup={createBinding(autoCpufreq, "activeProfile")
        .as(String)}
      pixelSize={18} />
  }
  return <Gtk.Image
    visible={createBinding(powerprof, "activeProfile")
      .as(p => p !== "balanced")}
    iconName={createBinding(powerprof, "iconName")}
    tooltipMarkup={createBinding(powerprof, "activeProfile")
      .as(String)}
    pixelSize={18} />
}
