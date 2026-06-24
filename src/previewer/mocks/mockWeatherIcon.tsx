/**
 * MockWeatherIcon — standalone preview of the weather icon + temp label.
 *
 * Visually matches src/widget/common/weatherWidget.tsx's WeatherIcon.
 */

import Gtk from "gi://Gtk?version=4.0"
import { IconNames, type IconName } from "#/lib/iconNames"

interface MockWeatherIconProps {
  iconName?: IconName
  temp?: string
}

export const MockWeatherIcon = (props: MockWeatherIconProps) => {
  const { iconName = IconNames.weatherCloudy, temp = "22°" } = props

  return (
    <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
      <Gtk.Image iconName={iconName} pixelSize={20} />
      <Gtk.Label label={temp} />
    </Gtk.Box>
  )
}
