import Gtk from "gi://Gtk?version=4.0"
import { Weather as WeatherWidget } from "#/widget/common/weatherWidget"


export const Weather = () => {
  return <Gtk.Box
    cssClasses={["card p-12"]}
    orientation={Gtk.Orientation.VERTICAL}

  >
    <Gtk.Label
      cssClasses={["title-3"]}
      label={"Weather Info"}
      halign={Gtk.Align.CENTER} />
    <WeatherWidget />
  </Gtk.Box>

}
