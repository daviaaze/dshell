import Gtk from "gi://Gtk?version=4.0"
import logger from "#/lib/logger"
import Powerprofiles from "./powerprofiles"

logger.log("ButtonGrid: loading")
import ColorScheme from "./colorScheme"
import Bluetooth from "./bluetooth"
import Caffeinated from "./caffeinated"
import Network from "../network"
import Screenshot from "./screenshot"
import NightLight from "./nightLight"
import NightLightLib from "#/lib/nightLight"
import IdleControls from "./idleControls"
import HypridleLib from "#/lib/hypridle"

export const ButtonGrid = ({ cols = 2 }:
  { cols?: number }) => {
  logger.log("ButtonGrid: rendering")
  const nightLight = NightLightLib.get_default()
  const items = [
    <Powerprofiles />,
    <ColorScheme />,
    <Bluetooth />,
    <Network />,
    <Screenshot />,
    <Caffeinated />,
    nightLight.available ? <NightLight /> : null,
    HypridleLib.get_default().available ? <IdleControls /> : null,
  ];

  const visibleItems = items.filter(Boolean)

  return <Gtk.Grid
    rowSpacing={4}
    columnSpacing={4}
    columnHomogeneous
    hexpand
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
