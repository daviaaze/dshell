/**
 * MockWeatherWidget — standalone preview of the weather widget.
 *
 * Visually matches src/widget/common/weatherWidget.tsx but uses
 * hardcoded mock data instead of GWeather + WeatherLib services.
 */

import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"
import { createState, For } from "gnim"
import { SunArc } from "#/widget/common/sunArc"

// ── Mock helpers ────────────────────────────────────────────────────────────

function formatTemp(celsius: number): string {
  const c = Math.round(celsius)
  return `${c > 0 ? "+" : ""}${c}°`
}

function formatTime(unix: number): string {
  const dt = GLib.DateTime.new_from_unix_local(unix)
  return dt.format("%H:%M") ?? "--:--"
}

function windDirLabel(dir: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
  return dirs[dir % 16] ?? "N"
}

// ── Mock data ───────────────────────────────────────────────────────────────

const NOW = GLib.DateTime.new_now_local().to_unix()
const MOCK_DATA = {
  locationName: "São Paulo, BR",
  iconName: "weather-overcast-symbolic",
  temp: 22,
  feelsLike: "Feels like 20°",
  skyDesc: "Partly Cloudy",
  sunrise: NOW - 6 * 3600, // 6 hours ago
  sunset: NOW + 6 * 3600, // 6 hours from now
  windSpeed: 15,
  windDir: 4, // ENE
  humidity: 65,
  pressure: 1013,
}

function mockHourly(count: number) {
  const items = []
  const start = GLib.DateTime.new_from_unix_local(NOW)
  for (let i = 0; i < count; i++) {
    const t = start.add_hours(i).to_unix()
    items.push({
      time: t,
      iconName: i % 2 === 0 ? "weather-overcast-symbolic" : "weather-few-clouds-symbolic",
      temp: 20 + Math.sin(i * 0.5) * 4,
    })
  }
  return items
}

function mockDaily(count: number) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const today = GLib.DateTime.new_now_local().get_day_of_week() - 1
  const items = []
  for (let i = 0; i < count; i++) {
    items.push({
      dayName: days[(today + i + 1) % 7],
      iconName: "weather-overcast-symbolic",
      tempMax: 24 + Math.sin(i) * 3,
      tempMin: 18 + Math.cos(i) * 2,
    })
  }
  return items
}

// ── Component ───────────────────────────────────────────────────────────────

interface MockWeatherWidgetProps {
  showForecast?: boolean
  showSunArc?: boolean
  showDetails?: boolean
  temperature?: number
}

export const MockWeatherWidget = (props: MockWeatherWidgetProps) => {
  const {
    showForecast = true,
    showSunArc = true,
    showDetails = true,
    temperature = 22,
  } = props

  const d = MOCK_DATA
  const [gradient, setGradient] = createState(
    "linear-gradient(135deg, #1e3a5f 0%, #4a90d9 100%)",
  )
  const hourly = mockHourly(8)
  const daily = mockDaily(5)
  const now = GLib.DateTime.new_now_local().to_unix()

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["weather-widget"]}
      $={(self: Gtk.Box) => {
        const p = new Gtk.CssProvider()
        p.load_from_string(
          `* { background: ${gradient()}; border-radius: 12px; }`,
        )
        self.get_style_context().add_provider(
          p,
          Gtk.STYLE_PROVIDER_PRIORITY_USER,
        )
      }}
    >
      {/* ── Header: icon + location + temp ── */}
      <Gtk.Box spacing={12} cssClasses={["p-12"]}>
        <Gtk.Image iconName={d.iconName} pixelSize={48} />
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
          <Gtk.Label
            cssClasses={["title-3"]}
            label={d.locationName}
            halign={Gtk.Align.START}
          />
          <Gtk.Label
            cssClasses={["weather-temp"]}
            label={formatTemp(temperature)}
            halign={Gtk.Align.START}
          />
          <Gtk.Label label={d.feelsLike} halign={Gtk.Align.START} />
          <Gtk.Label label={d.skyDesc} halign={Gtk.Align.START} />
        </Gtk.Box>
      </Gtk.Box>

      {/* ── SunArc ── */}
      {showSunArc && (
        <Gtk.Box cssClasses={["p-8"]}>
          <SunArc
            sunrise={() => d.sunrise}
            sunset={() => d.sunset}
            now={() => now}
          />
        </Gtk.Box>
      )}

      {/* ── Hourly Forecast ── */}
      {showForecast && (
        <Gtk.Box
          orientation={Gtk.Orientation.VERTICAL}
          cssClasses={["p-8", "weather-section"]}
        >
          <Gtk.Label
            cssClasses={["caption", "weather-section-label"]}
            label="Hourly"
            halign={Gtk.Align.START}
          />
          <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Gtk.Box spacing={4}>
              <For each={() => hourly}>
                {(f: typeof hourly[0]) => (
                  <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    cssClasses={["weather-hourly-item"]}
                    spacing={0}
                  >
                    <Gtk.Label
                      cssClasses={["weather-hourly-time"]}
                      label={formatTime(f.time)}
                    />
                    <Gtk.Image iconName={f.iconName} pixelSize={16} />
                    <Gtk.Label
                      cssClasses={["weather-hourly-temp"]}
                      label={formatTemp(f.temp)}
                    />
                  </Gtk.Box>
                )}
              </For>
            </Gtk.Box>
          </Gtk.ScrolledWindow>
        </Gtk.Box>
      )}

      {/* ── Daily Forecast ── */}
      {showForecast && (
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
            <For each={() => daily}>
              {(d: typeof daily[0]) => (
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
            </For>
          </Gtk.Box>
        </Gtk.Box>
      )}

      {/* ── Details ── */}
      {showDetails && (
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
            <Gtk.Box
              orientation={Gtk.Orientation.VERTICAL}
              cssClasses={["weather-detail-card"]}
              hexpand
            >
              <Gtk.Label
                label={`${d.windSpeed} km/h`}
                cssClasses={["weather-detail-value"]}
              />
              <Gtk.Label
                label={windDirLabel(d.windDir)}
                cssClasses={["caption"]}
              />
            </Gtk.Box>
            <Gtk.Box
              orientation={Gtk.Orientation.VERTICAL}
              cssClasses={["weather-detail-card"]}
              hexpand
            >
              <Gtk.Label
                label={`${d.humidity}%`}
                cssClasses={["weather-detail-value"]}
              />
              <Gtk.Label label="Humidity" cssClasses={["caption"]} />
            </Gtk.Box>
            <Gtk.Box
              orientation={Gtk.Orientation.VERTICAL}
              cssClasses={["weather-detail-card"]}
              hexpand
            >
              <Gtk.Label
                label={`${d.pressure} hPa`}
                cssClasses={["weather-detail-value"]}
              />
              <Gtk.Label label="Pressure" cssClasses={["caption"]} />
            </Gtk.Box>
          </Gtk.Box>
        </Gtk.Box>
      )}

      {/* ── Refresh button ── */}
      <Gtk.Button
        onClicked={() => print("[MockWeather] refresh clicked")}
        iconName="view-refresh-symbolic"
        cssClasses={["flat", "weather-refresh"]}
      />
    </Gtk.Box>
  )
}
