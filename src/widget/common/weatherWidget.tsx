import Gtk from 'gi://Gtk?version=4.0';
import {createBinding} from 'gnim';
import WeatherLib from '#/lib/services/location/weather';
import Clock from '#/lib/services/time/clock';
import {useStyle} from '#/style/useStyle';
import {SunArc} from '#/widget/common/sunArc';
import {WeatherDetails} from '#/widget/common/weatherDetails';
import {
    HourlyForecastSection,
    DailyForecastSection,
} from '#/widget/common/weatherForecast';

/**
 * Weather icon + temp summary, suitable for a compact indicator.
 */
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

/**
 * Full weather widget with current conditions, forecast, and details.
 */
export const WeatherWidget = () => {
    const weather = WeatherLib.get_default();
    const now = Clock.get_default().time.as(t => t.to_unix());

    const locationName = createBinding(weather, 'locationName');
    const tempSummary = createBinding(weather, 'tempSummary');
    const feelsLike = createBinding(weather, 'feelsLike');
    const skyDesc = createBinding(weather, 'skyDesc');
    const iconName = createBinding(weather, 'weatherIcon');
    const sunrise = createBinding(weather, 'sunrise');
    const sunset = createBinding(weather, 'sunset');
    const windSpeed = createBinding(weather, 'windSpeed');
    const windDirection = createBinding(weather, 'windDirection');
    const humidity = createBinding(weather, 'humidity');
    const pressure = createBinding(weather, 'pressure');
    const gradient = createBinding(weather, 'gradient');

    const hourlyForecast = createBinding(weather, 'info').as(_w =>
        weather.getHourlyForecast(8)
    );
    const dailyForecast = createBinding(weather, 'info').as(_w =>
        weather.getDailyForecast(5)
    );
    const moonPhase = createBinding(weather, 'info').as(_w =>
        weather.getMoonPhase()
    );

    const widgetStyle = useStyle({'min-width': '280px'});
    const tempStyle = useStyle({
        'font-size': '24px',
        'font-weight': 'bold',
    });
    const sectionStyle = useStyle({'margin-top': '8px'});
    const sectionLabelStyle = useStyle({
        'font-size': '11px',
        'font-weight': '600',
        'text-transform': 'uppercase',
        opacity: '0.7',
    });
    const refreshStyle = useStyle({
        padding: '4px',
        'border-radius': '8px',
        'margin-top': '8px',
    });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={['weather-widget', widgetStyle.class]}
            $={(self: Gtk.Box) => {
                const cssProvider = new Gtk.CssProvider();
                cssProvider.load_from_string(
                    `* { background: ${gradient()}; border-radius: var(--shade-radius); }`
                );
                self.get_style_context().add_provider(
                    cssProvider,
                    Gtk.STYLE_PROVIDER_PRIORITY_USER
                );
                gradient.subscribe(() => {
                    cssProvider.load_from_string(
                        `* { background: ${gradient()}; border-radius: var(--shade-radius); }`
                    );
                });
            }}
        >
            {/* ── Header: Icon + Location ── */}
            <Gtk.Box spacing={12} cssClasses={['p-12']}>
                <Gtk.Image iconName={iconName} pixelSize={48} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
                    <Gtk.Label
                        cssClasses={['title-3']}
                        label={locationName}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label
                        cssClasses={['weather-temp', tempStyle.class]}
                        label={tempSummary}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label label={feelsLike} halign={Gtk.Align.START} />
                    <Gtk.Label label={skyDesc} halign={Gtk.Align.START} />
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Sunrise/Sunset Arc ── */}
            <Gtk.Box cssClasses={['p-8']}>
                <SunArc
                    sunrise={sunrise}
                    sunset={sunset}
                    now={now}
                    moonPhase={moonPhase}
                />
            </Gtk.Box>

            {/* ── Hourly Forecast ── */}
            <HourlyForecastSection hourlyForecast={hourlyForecast} />

            {/* ── Daily Forecast ── */}
            <DailyForecastSection dailyForecast={dailyForecast} />

            {/* ── Detail Cards ── */}
            <Gtk.Box
                orientation={Gtk.Orientation.VERTICAL}
                cssClasses={['p-8', 'weather-section', sectionStyle.class]}
            >
                <Gtk.Label
                    cssClasses={[
                        'caption',
                        'weather-section-label',
                        sectionLabelStyle.class,
                    ]}
                    label="Details"
                    halign={Gtk.Align.START}
                />
                <WeatherDetails
                    windSpeed={windSpeed}
                    windDirection={windDirection}
                    humidity={humidity}
                    pressure={pressure}
                />
            </Gtk.Box>

            {/* ── Refresh Button ── */}
            <Gtk.Button
                onClicked={() => weather.refresh()}
                iconName="view-refresh-symbolic"
                cssClasses={['flat', 'weather-refresh', refreshStyle.class]}
            />
        </Gtk.Box>
    );
};
