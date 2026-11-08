import Gtk from 'gi://Gtk?version=4.0';
import logger from '@shade/core/logger';
import WeatherLib from '@shade/services/location/weather';
import {formatTime, windDirectionLabel} from '@shade/services/location/weatherUtils';
import {type Accessor, bind, computed} from 'gnim';
import {DailyForecastSection, HourlyForecastSection} from './weatherForecast';

const MOON_PHASES_PT: Record<string, string> = {
    'New Moon': 'Lua nova',
    'Waxing Crescent': 'Lua crescente',
    'First Quarter': 'Quarto crescente',
    'Waxing Gibbous': 'Crescente gibosa',
    'Full Moon': 'Lua cheia',
    'Waning Gibbous': 'Minguante gibosa',
    'Last Quarter': 'Quarto minguante',
    'Waning Crescent': 'Lua minguante',
};

const WEATHER_ERRORS_PT: Record<string, string> = {
    'Weather service is disposed': 'O serviço de clima foi encerrado',
    'No weather location is available': 'Nenhuma localização de clima disponível',
    'Weather update failed due to a network error': 'Falha ao atualizar o clima por erro de rede',
    'Weather data is invalid': 'Os dados do clima são inválidos',
    'Could not find a weather location for these coordinates':
        'Não foi possível encontrar uma localização de clima para estas coordenadas',
};

/** Display-only translation of service error messages; unknown messages pass through. */
const translateWeatherError = (message: string): string => WEATHER_ERRORS_PT[message] ?? message;

/** Display-only translation of the service's "Feels like X" string. */
const translateFeelsLike = (text: string): string => text.replace(/^Feels like /, 'Sensação ');

const WIND_DIRS_PT: Record<string, string> = {
    N: 'N',
    NNE: 'NNE',
    NE: 'NE',
    ENE: 'LNE',
    E: 'L',
    ESE: 'LSE',
    SE: 'SE',
    SSE: 'SSE',
    S: 'S',
    SSW: 'SSO',
    SW: 'SO',
    WSW: 'OSO',
    W: 'O',
    WNW: 'ONO',
    NW: 'NO',
    NNW: 'NNO',
};

/** Compass label in pt-BR (E→L, W→O); other labels are unchanged. */
const localizedWindDirection = (windEnum: number): string => {
    const label = windDirectionLabel(windEnum);
    return WIND_DIRS_PT[label] ?? label;
};
/**
 * Weather icon + temp summary, suitable for a compact indicator.
 */
export const WeatherIcon = () => {
    const weather = WeatherLib.get_default();
    return (
        <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
            <Gtk.Image
                iconName={bind(weather, 'info').as((w) => w?.get_icon_name() ?? '')}
                pixelSize={20}
            />
            <Gtk.Label
                label={bind(weather, 'info').as((w) =>
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
    return (
        <Gtk.Box marginTop={8} marginBottom={8} spacing={16} halign={Gtk.Align.CENTER}>
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image iconName={'daytime-sunrise-symbolic'} pixelSize={14} />
                <Gtk.Label label={sunrise.as((s) => formatTime(s))} cssClasses={['caption']} />
            </Gtk.Box>
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image iconName={'daytime-sunset-symbolic'} pixelSize={14} />
                <Gtk.Label label={sunset.as((s) => formatTime(s))} cssClasses={['caption']} />
            </Gtk.Box>
            <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
                <Gtk.Image iconName={moonPhase.as((m) => m?.iconName ?? '')} pixelSize={14} />
                <Gtk.Label
                    label={moonPhase.as((m) =>
                        m ? (MOON_PHASES_PT[m.phaseName] ?? m.phaseName) : ''
                    )}
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
    return (
        <Gtk.Label
            label={computed(
                () =>
                    `🍃 ${windSpeed().toFixed(0)} ${localizedWindDirection(windDirection())} · 💧 ${humidity().toFixed(0)}% · ${pressure().toFixed(0)} hPa`
            )}
            halign={Gtk.Align.CENTER}
            cssClasses={['caption', 'dimmed']}
        />
    );
};

/**
 * Full weather widget with current conditions, forecast, and details.
 */
export const WeatherWidget = () => {
    const weather = WeatherLib.get_default();
    const updateBusy = bind(weather, 'updateBusy');
    const updateError = bind(weather, 'updateError');
    const refreshStatus = computed(() =>
        updateBusy() ? 'Atualizando o clima…' : translateWeatherError(updateError() ?? '')
    );
    const refreshStatusVisible = computed(() => updateBusy() || updateError() !== null);
    const refreshWeather = async () => {
        try {
            await weather.refresh();
        } catch (error) {
            logger.error('weather', 'weather widget refresh failed:', error);
        }
    };

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

    return (
        <Gtk.Box marginTop={4} marginBottom={4} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
            {/* ── Header: icon + temp/location + refresh ── */}
            <Gtk.Box spacing={12} marginStart={8} marginEnd={8}>
                <Gtk.Image iconName={iconName} pixelSize={36} />
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand spacing={0}>
                    <Gtk.Label
                        cssClasses={['accent', 'title-1']}
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
                        label={computed(() => `${skyDesc()} · ${translateFeelsLike(feelsLike())}`)}
                        halign={Gtk.Align.START}
                        opacity={0.7}
                    />
                </Gtk.Box>
                <Gtk.Box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={4}
                    valign={Gtk.Align.START}
                >
                    <Gtk.Button
                        onClicked={refreshWeather}
                        iconName="view-refresh-symbolic"
                        cssClasses={['flat']}
                        tooltipText="Atualizar clima"
                        sensitive={computed(() => !updateBusy())}
                    />
                    <Gtk.Label
                        label={refreshStatus}
                        visible={refreshStatusVisible}
                        cssClasses={computed(() =>
                            updateError() ? ['caption', 'error'] : ['caption']
                        )}
                        halign={Gtk.Align.CENTER}
                        wrap
                        maxWidthChars={20}
                    />
                </Gtk.Box>
            </Gtk.Box>

            {/* ── Separator ── */}
            <Gtk.Separator />

            {/* ── Sun/Moon Row ── */}
            <SunMoonRow sunrise={sunrise} sunset={sunset} moonPhase={moonPhase} />

            {/* ── Separator ── */}
            <Gtk.Separator />

            {/* ── Hourly Forecast ── */}
            <HourlyForecastSection hourlyForecast={hourlyForecast} />

            {/* ── Separator ── */}
            <Gtk.Separator visible={hourlyForecast.as((items) => items.length > 0)} />

            {/* ── Daily Forecast ── */}
            <DailyForecastSection dailyForecast={dailyForecast} />

            {/* ── Separator ── */}
            <Gtk.Separator visible={dailyForecast.as((items) => items.length > 0)} />

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
