import GWeather from "#/lib/weather"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { IconInfoRow } from "#/widget/common/iconInfoRow"

export const WeatherIcon = () => {
  const weather = GWeather.get_default()
  return <IconInfoRow
    icon={createBinding(weather, "info")
      .as(w => w?.get_icon_name() ?? "")}
    primary={createBinding(weather, "info")
      .as(w => w?.is_valid() ? w.get_temp_summary() : "—")}
    secondary={createBinding(weather, "info")
      .as(w => w?.get_location_name() ?? "")}
  />
}

export const Weather = () => {
  const weather = GWeather.get_default()
  const weatherInfo = createBinding(weather, "info")
  const InfoBox = () =>
    <Gtk.Box
      hexpand
      spacing={4}
      orientation={Gtk.Orientation.VERTICAL}>
      <Gtk.Label
        cssClasses={["heading"]}
        halign={Gtk.Align.END}
        label={weatherInfo.as(w => w?.get_location_name() ?? "")}
      />
      <Gtk.Label
        cssClasses={["title-3"]}
        halign={Gtk.Align.END}
        label={weatherInfo.as(w =>
          w?.is_valid() ? w.get_temp_summary() : "Updating…")}
      />
      <Gtk.Label
        cssClasses={["title-3"]}
        halign={Gtk.Align.END}
        label={weatherInfo.as(w =>
          w?.is_valid() ? w.get_sky() : "")}
      />
      <Gtk.Label
        halign={Gtk.Align.END}
        label={weatherInfo.as(w =>
          w?.is_valid() ? `Feels like ${w.get_apparent()}` : "")}
      />
    </Gtk.Box>

  return <Gtk.Box
    orientation={Gtk.Orientation.VERTICAL}
    cssClasses={[]}
    spacing={4}>
    <Gtk.Box>
      <Gtk.Image
        iconName={weatherInfo.as(w => w?.get_icon_name() ?? "")}
        pixelSize={48} />
      <InfoBox />
    </Gtk.Box>
    <Gtk.Button
      onClicked={() => {
        weather.info.update()
      }}
      iconName={"view-refresh-symbolic"} />
  </Gtk.Box>
}
