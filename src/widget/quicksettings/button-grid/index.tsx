import Gtk from "gi://Gtk?version=4.0"
import Powerprofiles from "./powerprofiles"
import AutoCpufreq from "./autoCpufreq"
import AutoCpufreqLib from "#/lib/autoCpufreq"
import ColorScheme from "./colorScheme"
import Bluetooth from "./bluetooth"
import Caffeinated from "./caffeinated"
import Network from "./network"
import Screenshot from "./screenshot"
import Touchpad from "./touchpad"
import TouchpadLib from "#/lib/touchpad"

export const ButtonGrid = ({ cols = 2 }:
  { cols?: number }) => {
  const autoCpufreq = AutoCpufreqLib.get_default()
  const touchpad = TouchpadLib.get_default()
  const items = [
    autoCpufreq.available ? <AutoCpufreq /> : <Powerprofiles />,
    <ColorScheme />,
    <Bluetooth />,
    <Network />,
    <Screenshot />,
    <Caffeinated />,
    touchpad.available ? <Touchpad /> : null
  ];

  const visibleItems = items.filter(Boolean)

  return <Gtk.Grid rowSpacing={4} columnSpacing={4}
    $={(self) => visibleItems.forEach(
      (item, index) =>
        self.attach(
          item as Gtk.Widget,
          index % cols,
          Math.floor(index / cols),
          1, 1
        )
    )}>
  </Gtk.Grid>
}
