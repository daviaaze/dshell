import Gtk from 'gi://Gtk?version=4.0';
import {Accessor, bind, computed} from 'gnim';
import WeatherLib from '../../lib/services/location/weather';
import {
    formatTime,
    windDirectionLabel,
} from '../../lib/services/location/weatherUtils';
import {useStyle} from '../../style/useStyle';
import {
    HourlyForecastSection,
    DailyForecastSection,
} from './weatherForecast';

/**
 * Weather icon + temp summary, suitable for a compact indicator.
 */
export const WeatherIcon = () => {
    const weather = WeatherLib.get_default();
    return (
        <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName={bind(weather, 'info').as(
                    w => w?.get_icon_name() ?? ''
                )}
                pixelSize={20}
            />
            <Gtk.Label
                label={bind(weather, 'info').as(w =>
                    w?.is_valid() ? w.get_temp_summary() : '—'
                )}
            />
        </Gtk.Box>
    );
};

/**
 * Compact sunrise + sunset + moon phase row.
 */
const SunMoonRow = ({
    sunrise,
    sunset,
    moonPhase,
}: {
    sunrise: Accessor<number>;
    sunset: Accessor<number>;
    moonPhase: Accessor<{
        phase: number;
        phaseName: string;
        phaseEmoji: string;
        iconName: string;
    } | null>;
}) => {
    const rowStyle = useStyle({
        padding: '6px 0',
        'font-size': '12px',
        opacity: '0.8',
    });

    return (
        <Gtk.Box
            spacing={16}
            halign={Gtk.Align.CENTER}
            cssClasses={['weather-sun-moon-row', rowStyle.class]}
        >
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image
                    iconName={'daytime-sunrise-symbolic'}
                    pixelSize={14}
                />
                <Gtk.Label
                    label={sunrise.as(s => formatTime(s))}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image
                    iconName={'daytime-sunset-symbolic'}
                    pixelSize={14}
                />
                <Gtk.Label
                    label={sunset.as(s => formatTime(s))}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image
                    iconName={moonPhase.as(m => m?.iconName ?? '')}
                    pixelSize={14}
                />
                <Gtk.Label
                    label={moonPhase.as(m => m?.phaseName ?? '')}
                    cssClasses={['caption']}
                />
            </Gtk.Box>
        </Gtk.Box>
    );
};

/**
 * Compact details line: wind · humidity · pressure
 */
const DetailsLine = ({
    windSpeed,
    windDirection,
    humidity,
    pressure,
}: {
    windSpeed: Accessor<number>;
    windDirection: Accessor<number>;
    humidity: Accessor<number>;
    pressure: Accessor<number>;
}) => {
    const lineStyle = useStyle({
        padding: '6px 0',
        'font-size': '11px',
        opacity: '0.7',
    });

    return (
        <Gtk.Label
            label={computed(
                () =>
                    `🍃 ${windSpeed().toFixed(0)} ${windDirectionLabel(windDirection())} · 💧 ${humidity().toFixed(0)}% · ${pressure().toFixed(0)} hPa`
            )}
            halign={Gtk.Align.CENTER}
            cssClasses={['weather-details-line', lineStyle.class]}
        />
    );
};

/**
 * Full weather widget with current conditions, forecast, and details.
 */
export const WeatherWidget = () => {
    const weather = WeatherLib.get_default();

    const locationName = bind(weather, 'locationName');
    const tempSummary = bind(weather, 'tempSummary');
    const feelsLike = bind(weather, 'feelsLike');
    const skyDesc = bind(weather, 'skyDesc');
    const iconName = bind(weather, 'weatherIcon');
    const sunrise = bind(weather, 'sunrise');
    const sunset = bind(weather, 'sunset');
    const windSpeed = bind(weather, 'windSpeed');
    const windDirection = bind(weather, 'windDirection');
    const humidity = bind(weather, 'humidity');
    const pressure = bind(weather, 'pressure');

    // Memoized: only recomputes when weather.info actually changes
    const hourlyForecast = computed(() => {
        bind(weather, 'info')();
        return weather.getHourlyForecast(8);
    });
    const dailyForecast = computed(() => {
        bind(weather, 'info')();
        return weather.getDailyForecast(5);
    });
    const moonPhase = computed(() => {
        bind(weather, 'info')();
        return weather.getMoonPhase();
    });

    const tempStyle = useStyle({
        'font-size': '24px',
        'font-weight': 'bold',
    });
    const separatorStyle = useStyle({
        'min-height': '1px',
        background: 'var(--shade-outline-variant)',
        margin: '4px 0',
    });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            cssClasses={['weather-widget']}
        >
            {/* ── Header: icon + temp/location + refresh ── */}
            <Gtk.Box spacing={12} cssClasses={['p-12']}>
                <Gtk.Image iconName={iconName} pixelSize={36} />
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    hexpand
                    spacing={0}
                >
                    <Gtk.Label
                        cssClasses={['weather-temp', tempStyle.class]}
                        label={tempSummary}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label
                        cssClasses={['caption']}
                        label={locationName}
                        halign={Gtk.Align.START}
                    />
                    <Gtk.Label
                        cssClasses={['caption']}
                        label={computed(() => `${skyDesc()} · ${feelsLike()}`)}
                        halign={Gtk.Align.START}
                        opacity={0.7}
                    />
                </Gtk.Box>
                <Gtk.Button
                    onClicked={() => weather.refresh()}
                    iconName="view-refresh-symbolic"
                    cssClasses={['flat']}
                    valign={Gtk.Align.START}
                />
            </Gtk.Box>

            {/* ── Separator ── */}
            <Gtk.Box cssClasses={[separatorStyle.class]} />

            {/* ── Sun/Moon Row ── */}
            <SunMoonRow
                sunrise={sunrise}
                sunset={sunset}
                moonPhase={moonPhase}
            />

            {/* ── Separator ── */}
            <Gtk.Box cssClasses={[separatorStyle.class]} />

            {/* ── Hourly Forecast ── */}
            <HourlyForecastSection hourlyForecast={hourlyForecast} />

            {/* ── Separator ── */}
            <Gtk.Box cssClasses={[separatorStyle.class]} />

            {/* ── Daily Forecast ── */}
            <DailyForecastSection dailyForecast={dailyForecast} />

            {/* ── Separator ── */}
            <Gtk.Box cssClasses={[separatorStyle.class]} />

            {/* ── Details Line ── */}
            <DetailsLine
                windSpeed={windSpeed}
                windDirection={windDirection}
                humidity={humidity}
                pressure={pressure}
            />
        </Gtk.Box>
    );
};
