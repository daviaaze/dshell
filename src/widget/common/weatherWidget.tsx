import GWeather from 'gi://GWeather?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createState, onCleanup, For} from 'gnim';
import WeatherLib from '#/lib/weather';
import {
    weatherGradient,
    formatTemp,
    formatTime,
    windDirectionLabel,
} from '#/lib/weatherUtils';
import {SunArc} from '#/widget/common/sunArc';

export const WeatherIcon = () => {
    const weather = WeatherLib.get_default();
    return (
        <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName={createBinding(weather, 'info').as(
                    w => w?.get_icon_name() ?? ''
                )}
                pixelSize={20}
            />
            <Gtk.Label
                label={createBinding(weather, 'info').as(w =>
                    w?.is_valid() ? w.get_temp_summary() : '—'
                )}
            />
        </Gtk.Box>
    );
};

// ── Data layer: all reactive bindings extracted from WeatherWidget ──

function useWeatherData(
    weather: typeof WeatherLib.get_default,
    info: ReturnType<typeof createBinding>
) {
    const [now, setNow] = createState(GLib.DateTime.new_now_local().to_unix());
    const nowTimerId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        30,
        () => {
            setNow(GLib.DateTime.new_now_local().to_unix());
            return GLib.SOURCE_CONTINUE;
        }
    );
    onCleanup(() => {
        if (nowTimerId) GLib.Source.remove(nowTimerId);
    });

    const [gradient, setGradient] = createState(
        'linear-gradient(135deg, #1e3a5f 0%, #4a90d9 100%)'
    );
    info.subscribe(w => {
        setGradient(
            w?.is_valid()
                ? weatherGradient(w.get_icon_name() ?? '')
                : 'linear-gradient(135deg, #1e3a5f 0%, #4a90d9 100%)'
        );
    });

    return {
        now,
        gradient,
        locationName: info.as(w => w?.get_location_name() ?? '\u2014'),
        temp: info.as(w =>
            w?.is_valid()
                ? formatTemp(
                      w.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE)[1]
                  )
                : '--\u00b0'
        ),
        feelsLike: info.as(w =>
            w?.is_valid() ? `Feels like ${w.get_apparent()}` : ''
        ),
        skyDesc: info.as(w => w?.get_sky() ?? ''),
        iconName: info.as(
            w => w?.get_icon_name() ?? 'weather-none-available-symbolic'
        ),
        sunrise: info.as(w => (w?.is_valid() ? w.get_value_sunrise()[1] : 0)),
        sunset: info.as(w => (w?.is_valid() ? w.get_value_sunset()[1] : 0)),
        windSpeed: info.as(w => {
            if (!w?.is_valid()) return 0;
            const [, s] = w.get_value_wind(GWeather.SpeedUnit.KMH);
            return s;
        }),
        windDir: info.as(w => {
            if (!w?.is_valid()) return 0;
            const [, , d] = w.get_value_wind(GWeather.SpeedUnit.KMH);
            return d;
        }),
        humidity: info.as(w => {
            if (!w?.is_valid()) return 0;
            const h = w.get_humidity();
            return h ? parseFloat(h) : 0;
        }),
        pressure: info.as(w => {
            if (!w?.is_valid()) return 0;
            const [, p] = w.get_value_pressure(GWeather.PressureUnit.HPA);
            return p;
        }),
        hourlyForecast: info.as(w =>
            w?.is_valid() ? weather.getHourlyForecast(8) : []
        ),
        dailyForecast: info.as(w =>
            w?.is_valid() ? weather.getDailyForecast(5) : []
        ),
        moonPhase: info.as(w =>
            w?.is_valid() ? weather.getMoonPhase() : null
        ),
    };
}

export const WeatherWidget = () => {
    const weather = WeatherLib.get_default();
    const info = createBinding(weather, 'info');
    const data = useWeatherData(weather, info);

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['weather-widget']}
            $={(self: Gtk.Box) => {
                const cssProvider = new Gtk.CssProvider();
                cssProvider.load_from_string(
                    `* { background: ${data.gradient()}; border-radius: 12px; }`
                );
                self.get_style_context().add_provider(
                    cssProvider,
                    Gtk.STYLE_PROVIDER_PRIORITY_USER
                );
                data.gradient.subscribe(g => {
                    cssProvider.load_from_string(
                        `* { background: ${g}; border-radius: 12px; }`
                    );
                });
            }}
        >
            {/* ── Header: Icon + Location ── */}
            <Gtk.Box spacing={12} cssClasses={['p-12']}>
                <Gtk.Image iconName={data.iconName} pixelSize={48} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Label
                        cssClasses={['title-3']}
                        label={data.locationName}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label
                        cssClasses={['weather-temp']}
                        label={data.temp}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label
                        label={data.feelsLike}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label label={data.skyDesc} halign={Gtk.Align.START} />
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Sunrise/Sunset Arc (updates every 30s via timeout) ── */}
            <Gtk.Box cssClasses={['p-8']}>
                <SunArc
                    sunrise={data.sunrise}
                    sunset={data.sunset}
                    now={data.now}
                    moonPhase={data.moonPhase}
                />
            </Gtk.Box>

            {/* ── Hourly Forecast ── */}
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['p-8', 'weather-section']}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label']}
                    label="Hourly"
                    halign={Gtk.Align.START}
                />
                <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER}>
                    <Gtk.Box spacing={4}>
                        <For each={data.hourlyForecast}>
                            {f => (
                                <Gtk.Box
                                    orientation={Gtk.Orientation.VERTICAL}
                                    cssClasses={['weather-hourly-item']}
                                    spacing={0}
                                >
                                    <Gtk.Label
                                        cssClasses={['weather-hourly-time']}
                                        label={formatTime(f.time)}
                                    />
                                    <Gtk.Image
                                        iconName={f.iconName}
                                        pixelSize={16}
                                    />
                                    <Gtk.Label
                                        cssClasses={['weather-hourly-temp']}
                                        label={formatTemp(f.temp)}
                                    />
                                </Gtk.Box>
                            )}
                        </For>
                    </Gtk.Box>
                </Gtk.ScrolledWindow>
            </Gtk.Box>

            {/* ── Daily Forecast ── */}
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['p-8', 'weather-section']}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label']}
                    label="5-Day Forecast"
                    halign={Gtk.Align.START}
                />
                <Gtk.Box spacing={8} hexpand homogeneous>
                    <For each={data.dailyForecast}>
                        {d => (
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                cssClasses={['weather-daily-item']}
                                spacing={2}
                            >
                                <Gtk.Label
                                    cssClasses={['caption']}
                                    label={d.dayName}
                                />
                                <Gtk.Image
                                    iconName={d.iconName}
                                    pixelSize={18}
                                />
                                <Gtk.Label
                                    label={`${formatTemp(d.tempMax)} / ${formatTemp(d.tempMin)}`}
                                    cssClasses={['weather-temp-small']}
                                />
                            </Gtk.Box>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Detail Cards ── */}
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['p-8', 'weather-section']}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label']}
                    label="Details"
                    halign={Gtk.Align.START}
                />
                <Gtk.Box spacing={6} hexpand>
                    {/* Wind */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card']}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.windSpeed.as(
                                s => `${s.toFixed(0)} km/h`
                            )}
                            cssClasses={['weather-detail-value']}
                        />
                        <Gtk.Label
                            label={data.windDir.as(d => windDirectionLabel(d))}
                            cssClasses={['caption']}
                        />
                    </Gtk.Box>
                    {/* Humidity */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card']}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.humidity.as(h => `${h.toFixed(0)}%`)}
                            cssClasses={['weather-detail-value']}
                        />
                        <Gtk.Label label="Humidity" cssClasses={['caption']} />
                    </Gtk.Box>
                    {/* Pressure */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card']}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.pressure.as(p => `${p.toFixed(0)} hPa`)}
                            cssClasses={['weather-detail-value']}
                        />
                        <Gtk.Label label="Pressure" cssClasses={['caption']} />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Refresh Button ── */}
            <Gtk.Button
                onClicked={() => weather.info.update()}
                iconName="view-refresh-symbolic"
                cssClasses={['flat', 'weather-refresh']}
            />
        </Gtk.Box>
    );
};
