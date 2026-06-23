import GWeather from "gi://GWeather?version=4.0"
import GLib from "gi://GLib?version=2.0"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createState, onCleanup, For } from "gnim"
import WeatherLib from "#/lib/weather"
import {
  weatherGradient,
  formatTemp,
  formatTime,
  windDirectionLabel,
} from "#/lib/weatherUtils"
import { SunArc } from "#/widget/common/sunArc"

export const WeatherIcon = () => {
  const weather = WeatherLib.get_default()
  return (
    <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
      <Gtk.Image
        iconName={createBinding(weather, "info").as(
          (w) => w?.get_icon_name() ?? "",
        )}
        pixelSize={20}
      />
      <Gtk.Label
        label={createBinding(weather, "info").as((w) =>
          w?.is_valid() ? w.get_temp_summary() : "—",
        )}
      />
    </Gtk.Box>
  )
}

export const WeatherWidget = () => {
  const weather = WeatherLib.get_default()
  const info = createBinding(weather, "info")

  // Track 'now' every 30s so the sun arc stays current
  const [now, setNow] = createState(GLib.DateTime.new_now_local().to_unix())
  const nowTimerId = GLib.timeout_add_seconds(
    GLib.PRIORITY_DEFAULT,
    30,
    () => {
      setNow(GLib.DateTime.new_now_local().to_unix())
      return GLib.SOURCE_CONTINUE
    },
  )
  onCleanup(() => {
    if (nowTimerId) GLib.Source.remove(nowTimerId)
  })

  // Reactive bindings from weather info
  const locationName = info.as((w) => w?.get_location_name() ?? "—")
  const temp = info.as((w) =>
    w?.is_valid()
      ? formatTemp(
          w.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE)[1],
        )
      : "--°",
  )
  const feelsLike = info.as((w) =>
    w?.is_valid()
      ? `Feels like ${w.get_apparent()}`
      : "",
  )
  const skyDesc = info.as((w) => w?.get_sky() ?? "")
  const iconName = info.as(
    (w) => w?.get_icon_name() ?? "weather-none-available-symbolic",
  )

  // Gradient based on weather icon name
  const [gradient, setGradient] = createState(
    "linear-gradient(135deg, #1e3a5f 0%, #4a90d9 100%)",
  )
  info.subscribe((w) => {
    setGradient(
      w?.is_valid()
        ? weatherGradient(w.get_icon_name() ?? "")
        : "linear-gradient(135deg, #1e3a5f 0%, #4a90d9 100%)",
    )
  })

  // Sunrise/sunset
  const sunrise = info.as((w) =>
    w?.is_valid() ? w.get_value_sunrise()[1] : 0,
  )
  const sunset = info.as((w) =>
    w?.is_valid() ? w.get_value_sunset()[1] : 0,
  )

  // Detail data — GJS maps GIR out-params to return values:
  // get_value_wind(unit) → [isValid, speed, WindDirection] (enum 1-16, not degrees)
  // get_humidity() → string (e.g. "55%") — no out-params
  // get_value_pressure(unit) → [isValid, hPa]
  const windSpeed = info.as((w) => {
    if (!w?.is_valid()) return 0
    const [, speed] = w.get_value_wind(GWeather.SpeedUnit.KMH)
    return speed
  })
  const windDir = info.as((w) => {
    if (!w?.is_valid()) return 0
    const [, , dir] = w.get_value_wind(GWeather.SpeedUnit.KMH)
    return dir // GWeatherWindDirection enum (1-16)
  })
  const humidity = info.as((w) => {
    if (!w?.is_valid()) return 0
    const hStr = w.get_humidity()
    return hStr ? parseFloat(hStr) : 0
  })
  const pressure = info.as((w) => {
    if (!w?.is_valid()) return 0
    const [, p] = w.get_value_pressure(GWeather.PressureUnit.HPA)
    return p
  })

  // Forecast
  const hourlyForecast = info.as(() => {
    if (!info()?.is_valid()) return []
    return weather.getHourlyForecast(8)
  })
  const dailyForecast = info.as(() => {
    if (!info()?.is_valid()) return []
    return weather.getDailyForecast(5)
  })

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["weather-widget"]}
      $={(self: Gtk.Box) => {
        const cssProvider = new Gtk.CssProvider()
        cssProvider.load_from_string(
          `* { background: ${gradient()}; border-radius: 12px; }`,
        )
        self.get_style_context().add_provider(
          cssProvider,
          Gtk.STYLE_PROVIDER_PRIORITY_USER,
        )
        gradient.subscribe((g) => {
          cssProvider.load_from_string(
            `* { background: ${g}; border-radius: 12px; }`,
          )
        })
      }}
    >
      {/* ── Header: Icon + Location ── */}
      <Gtk.Box spacing={12} cssClasses={["p-12"]}>
        <Gtk.Image iconName={iconName} pixelSize={48} />
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
          <Gtk.Label
            cssClasses={["title-3"]}
            label={locationName}
            halign={Gtk.Align.START}
          />
          <Gtk.Label
            cssClasses={["weather-temp"]}
            label={temp}
            halign={Gtk.Align.START}
          />
          <Gtk.Label label={feelsLike} halign={Gtk.Align.START} />
          <Gtk.Label label={skyDesc} halign={Gtk.Align.START} />
        </Gtk.Box>
      </Gtk.Box>

      {/* ── Sunrise/Sunset Arc (updates every 30s via timeout) ── */}
      <Gtk.Box cssClasses={["p-8"]}>
        <SunArc sunrise={sunrise} sunset={sunset} now={now} />
      </Gtk.Box>

      {/* ── Hourly Forecast ── */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["p-8", "weather-section"]}
      >
        <Gtk.Label
          cssClasses={["caption", "weather-section-label"]}
          label="Hourly Forecast"
          halign={Gtk.Align.START}
        />
        <Gtk.ScrolledWindow
          hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        >
          <Gtk.Box spacing={8}>
            <For
              each={hourlyForecast}
              callback={(f) => (
                <Gtk.Box
                  orientation={Gtk.Orientation.VERTICAL}
                  cssClasses={["weather-hourly-item"]}
                  spacing={2}
                >
                  <Gtk.Label
                    cssClasses={["caption"]}
                    label={formatTime(f.time)}
                  />
                  <Gtk.Image iconName={f.iconName} pixelSize={20} />
                  <Gtk.Label label={formatTemp(f.temp)} />
                </Gtk.Box>
              )}
            />
          </Gtk.Box>
        </Gtk.ScrolledWindow>
      </Gtk.Box>

      {/* ── Daily Forecast ── */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["p-8", "weather-section"]}
      >
        <Gtk.Label
          cssClasses={["caption", "weather-section-label"]}
          label="5-Day Forecast"
          halign={Gtk.Align.START}
        />
        <Gtk.Box spacing={8} hexpand homogeneous>
          <For
            each={dailyForecast}
            callback={(d) => (
              <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={["weather-daily-item"]}
                spacing={2}
              >
                <Gtk.Label cssClasses={["caption"]} label={d.dayName} />
                <Gtk.Image iconName={d.iconName} pixelSize={18} />
                <Gtk.Label
                  label={`${formatTemp(d.tempMax)} / ${formatTemp(d.tempMin)}`}
                  cssClasses={["weather-temp-small"]}
                />
              </Gtk.Box>
            )}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* ── Detail Cards ── */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["p-8", "weather-section"]}
      >
        <Gtk.Label
          cssClasses={["caption", "weather-section-label"]}
          label="Details"
          halign={Gtk.Align.START}
        />
        <Gtk.Box spacing={6} hexpand>
          {/* Wind */}
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["weather-detail-card"]}
            hexpand
          >
            <Gtk.Image
              iconName="weather-windy-symbolic"
              pixelSize={16}
            />
            <Gtk.Label
              label={windSpeed.as((s) => `${s.toFixed(0)} km/h`)}
              cssClasses={["weather-detail-value"]}
            />
            <Gtk.Label
              label={windDir.as((d) => windDirectionLabel(d))}
              cssClasses={["caption"]}
            />
          </Gtk.Box>
          {/* Humidity */}
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["weather-detail-card"]}
            hexpand
          >
            <Gtk.Image
              iconName="weather-temp-symbolic"
              pixelSize={16}
            />
            <Gtk.Label
              label={humidity.as((h) => `${h.toFixed(0)}%`)}
              cssClasses={["weather-detail-value"]}
            />
            <Gtk.Label label="Humidity" cssClasses={["caption"]} />
          </Gtk.Box>
          {/* Pressure */}
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["weather-detail-card"]}
            hexpand
          >
            <Gtk.Image
              iconName="weather-temp-symbolic"
              pixelSize={16}
            />
            <Gtk.Label
              label={pressure.as((p) => `${p.toFixed(0)} hPa`)}
              cssClasses={["weather-detail-value"]}
            />
            <Gtk.Label label="Pressure" cssClasses={["caption"]} />
          </Gtk.Box>
        </Gtk.Box>
      </Gtk.Box>

      {/* ── Refresh Button ── */}
      <Gtk.Button
        onClicked={() => weather.info.update()}
        iconName="view-refresh-symbolic"
        cssClasses={["flat", "weather-refresh"]}
      />
    </Gtk.Box>
  )
}
