import GWeather from 'gi://GWeather?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {createBinding, createState, onCleanup, For} from 'gnim';
import {useStyle} from '#/style/useStyle';
import WeatherLib from '#/lib/services/location/weather';
import {
    weatherGradient,
    formatTemp,
    formatTime,
    windDirectionLabel,
} from '#/lib/services/location/weatherUtils';
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
            const [, s] = w.get_value_wind(GWeather.SpeedUnit.DEFAULT);
            return s;
        }),
        windDir: info.as(w => {
            if (!w?.is_valid()) return 0;
            const [, , d] = w.get_value_wind(GWeather.SpeedUnit.DEFAULT);
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

    const widgetStyle = useStyle({ 'min-width': '280px' });
    const tempStyle = useStyle({ 'font-size': '24px', 'font-weight': 'bold' });
    const tempSmallStyle = useStyle({ 'font-size': '12px', 'font-weight': '600' });
    const sectionStyle = useStyle({ 'margin-top': '8px' });
    const sectionLabelStyle = useStyle({ 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase', opacity: '0.7' });
    const hourlyItemStyle = useStyle({ 'min-width': '48px', padding: '4px 0' });
    const hourlyTimeStyle = useStyle({ 'font-size': '11px', opacity: '0.7' });
    const hourlyTempStyle = useStyle({ 'font-size': '13px', 'font-weight': '600' });
    const dailyItemStyle = useStyle({ padding: '4px', 'border-radius': '8px' });
    const detailCardStyle = useStyle({ padding: '8px', 'border-radius': '8px', background: 'rgba(128,128,128,0.1)' });
    const detailValueStyle = useStyle({ 'font-size': '18px', 'font-weight': 'bold' });
    const refreshStyle = useStyle({ padding: '4px', 'border-radius': '8px', 'margin-top': '8px' });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['weather-widget', widgetStyle.class]}
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
                        cssClasses={['weather-temp', tempStyle.class]}
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
                cssClasses={['p-8', 'weather-section', sectionStyle.class]}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label', sectionLabelStyle.class]}
                    label="Hourly"
                    halign={Gtk.Align.START}
                />
                <Gtk.ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.NEVER}>
                    <Gtk.Box spacing={4}>
                        <For each={data.hourlyForecast}>
                            {f => (
                                <Gtk.Box
                                    orientation={Gtk.Orientation.VERTICAL}
                                    cssClasses={['weather-hourly-item', hourlyItemStyle.class]}
                                    spacing={0}
                                >
                                    <Gtk.Label
                                        cssClasses={['weather-hourly-time', hourlyTimeStyle.class]}
                                        label={formatTime(f.time)}
                                    />
                                    <Gtk.Image
                                        iconName={f.iconName}
                                        pixelSize={16}
                                    />
                                    <Gtk.Label
                                        cssClasses={['weather-hourly-temp', hourlyTempStyle.class]}
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
                cssClasses={['p-8', 'weather-section', sectionStyle.class]}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label', sectionLabelStyle.class]}
                    label="5-Day Forecast"
                    halign={Gtk.Align.START}
                />
                <Gtk.Box spacing={8} hexpand homogeneous>
                    <For each={data.dailyForecast}>
                        {d => (
                            <Gtk.Box
                                orientation={Gtk.Orientation.VERTICAL}
                                cssClasses={['weather-daily-item', dailyItemStyle.class]}
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
                                    cssClasses={['weather-temp-small', tempSmallStyle.class]}
                                />
                            </Gtk.Box>
                        )}
                    </For>
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Detail Cards ── */}
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['p-8', 'weather-section', sectionStyle.class]}
            >
                <Gtk.Label
                    cssClasses={['caption', 'weather-section-label', sectionLabelStyle.class]}
                    label="Details"
                    halign={Gtk.Align.START}
                />
                <Gtk.Box spacing={6} hexpand>
                    {/* Wind */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card', detailCardStyle.class]}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.windSpeed.as(
                                s => `${s.toFixed(0)} km/h`
                            )}
                            cssClasses={['weather-detail-value', detailValueStyle.class]}
                        />
                        <Gtk.Label
                            label={data.windDir.as(d => windDirectionLabel(d))}
                            cssClasses={['caption']}
                        />
                    </Gtk.Box>
                    {/* Humidity */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card', detailCardStyle.class]}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.humidity.as(h => `${h.toFixed(0)}%`)}
                            cssClasses={['weather-detail-value', detailValueStyle.class]}
                        />
                        <Gtk.Label label="Humidity" cssClasses={['caption']} />
                    </Gtk.Box>
                    {/* Pressure */}
                    <Gtk.Box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={['weather-detail-card', detailCardStyle.class]}
                        hexpand
                    >
                        <Gtk.Label
                            label={data.pressure.as(p => `${p.toFixed(0)} hPa`)}
                            cssClasses={['weather-detail-value', detailValueStyle.class]}
                        />
                        <Gtk.Label label="Pressure" cssClasses={['caption']} />
                    </Gtk.Box>
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Refresh Button ── */}
            <Gtk.Button
                onClicked={() => weather.info.update()}
                iconName="view-refresh-symbolic"
                cssClasses={['flat', 'weather-refresh', refreshStyle.class]}
            />
        </Gtk.Box>
    );
};
