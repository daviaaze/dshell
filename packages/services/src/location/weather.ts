import GObject from 'gi://GObject?version=2.0';
import GWeather from 'gi://GWeather?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import Geolocation from './geolocation';
import logger from '@shade/core/logger';
import {Accessor} from 'gnim';
import {toArray} from '@shade/core/gjsUtils';
import {formatTemp} from './weatherUtils';
import {defineService} from '@shade/core/define';
import {weatherSettings} from './weather.gschema';

@register
export default class Weather extends Object {
    private static instance: Weather;

    static get_default() {
        if (!this.instance) this.instance = new Weather();
        return this.instance;
    }

    #weather: GWeather.Info;
    #location: GWeather.Location | undefined;
    #geo = Geolocation.get_default();
    #updateTimer: number | null = null;
    #weatherHandlerId = 0;
    #initialized = false;
    #generalSettings: Gio.Settings;

    @property
    get info() {
        return this.#weather;
    }

    // ── Computed detail getters (updated on info change) ──

    #tempSummary = '--°';

    @property
    get tempSummary() {
        return this.#tempSummary;
    }

    #feelsLike = '';

    @property
    get feelsLike() {
        return this.#feelsLike;
    }

    #skyDesc = '';

    @property
    get skyDesc() {
        return this.#skyDesc;
    }

    #locationName = '—';

    @property
    get locationName() {
        return this.#locationName;
    }

    #weatherIcon = 'weather-none-available-symbolic';

    @property
    get weatherIcon() {
        return this.#weatherIcon;
    }

    #windSpeed = 0;

    @property
    get windSpeed() {
        return this.#windSpeed;
    }

    #windDirection = 0;

    @property
    get windDirection() {
        return this.#windDirection;
    }

    #humidity = 0;

    @property
    get humidity() {
        return this.#humidity;
    }

    #pressure = 0;

    @property
    get pressure() {
        return this.#pressure;
    }

    #sunrise = 0;

    @property
    get sunrise() {
        return this.#sunrise;
    }

    #sunset = 0;

    @property
    get sunset() {
        return this.#sunset;
    }

    #updateComputed() {
        const w = this.#weather;
        const valid = w.is_valid();

        this.#tempSummary = valid
            ? formatTemp(
                  w.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE)[1]
              )
            : '--°';
        this.#feelsLike = valid ? `Feels like ${w.get_apparent()}` : '';
        this.#skyDesc = valid ? w.get_sky() : '';
        this.#locationName = w.get_location_name() || '—';
        this.#weatherIcon =
            w.get_icon_name() || 'weather-none-available-symbolic';

        if (valid) {
            const [, speed, dir] = w.get_value_wind(GWeather.SpeedUnit.DEFAULT);
            this.#windSpeed = speed;
            this.#windDirection = dir;
            const humStr = w.get_humidity();
            this.#humidity = humStr ? parseFloat(humStr) : 0;
            const [, pressure] = w.get_value_pressure(
                GWeather.PressureUnit.HPA
            );
            this.#pressure = pressure;
            const [, sunrise] = w.get_value_sunrise();
            this.#sunrise = sunrise;
            const [, sunset] = w.get_value_sunset();
            this.#sunset = sunset;
        }

        this.notify('temp-summary');
        this.notify('feels-like');
        this.notify('sky-desc');
        this.notify('location-name');
        this.notify('weather-icon');
        this.notify('wind-speed');
        this.notify('wind-direction');
        this.notify('humidity');
        this.notify('pressure');
        this.notify('sunrise');
        this.notify('sunset');
    }

    set location(location: GWeather.Location | undefined) {
        if (!location) return;
        this.#location = location;
        this.#weather.set_location(location);
        this.#weather.update();
        this.notify('location');
    }

    updateFromCoords(lat: number, lon: number) {
        const newLoc = GWeather.Location.get_world()?.find_nearest_city(
            lat,
            lon
        );
        if (newLoc) this.location = newLoc;
    }

    detectLocation() {
        this.#geo.detect();
    }

    init(settings: {
        latitude: Accessor<number>;
        longitude: Accessor<number>;
        autoLocation: Accessor<boolean>;
        setLatitude(lat: number): void;
        setLongitude(lon: number): void;
    }) {
        if (this.#initialized) {
            logger.warn(
                'weather',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        this.#location = GWeather.Location.get_world()?.find_nearest_city(
            settings.latitude(),
            settings.longitude()
        );

        if (this.#location) {
            this.#weather.set_location(this.#location);
            this.#weather.update();
        }

        this.#updateTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            0.25 * 3600000,
            () => {
                this.#weather.update();
                return GLib.SOURCE_CONTINUE;
            }
        );

        let geoHandlerId: number | null = null;

        const connectGeo = () => {
            if (geoHandlerId !== null) {
                this.#geo.disconnect(geoHandlerId);
                geoHandlerId = null;
            }
            geoHandlerId = GObject.signal_connect(this.#geo, 'location-changed', (_source: Geolocation, ...args: unknown[]) => {
                const lat = args[0] as number;
                const lon = args[1] as number;
                settings.setLatitude(lat);
                settings.setLongitude(lon);
                this.updateFromCoords(lat, lon);
            });
        };

        // Auto-location on startup if enabled
        if (settings.autoLocation()) {
            connectGeo();
            this.detectLocation();
        }

        settings.autoLocation.subscribe(() => {
            const enabled = settings.autoLocation();
            if (enabled) {
                connectGeo();
                this.detectLocation();
            } else if (geoHandlerId !== null) {
                this.#geo.disconnect(geoHandlerId);
                geoHandlerId = null;
            }
        });
    }

    // ── Forecast helpers ─────────────────────────────────────────────

    /** Returns forecast entries for the next N hours */
    getHourlyForecast(hours: number = 12): Array<{
        time: number;
        temp: number;
        iconName: string;
    }> {
        const list = this.#weather.get_forecast_list();
        if (!list) return [];
        const forecasts = toArray<GWeather.Info>(list);
        const now = GLib.DateTime.new_now_local()!.to_unix();

        logger.debug(
            'weather',
            `getHourlyForecast: found ${forecasts.length} forecast entries`
        );

        const future = forecasts.filter(f => {
            const [valid, ts] = f.get_value_update();
            return valid && ts > now;
        });

        logger.debug(
            'weather',
            `getHourlyForecast: ${future.length} future entries, first in ${future.length > 0 ? future[0].get_value_update()[1] - now : 0}s`
        );

        return future.slice(0, hours).map(f => {
            const [, ts] = f.get_value_update();
            const isValid = f.is_valid();
            let temp = NaN;
            if (isValid) {
                const [tempValid, tempVal] = f.get_value_temp(
                    GWeather.TemperatureUnit.CENTIGRADE
                );
                temp = tempValid ? tempVal : NaN;
            }
            return {
                time: ts,
                temp,
                iconName: f.get_icon_name(),
            };
        });
    }

    /** Returns daily forecast entries grouped by day */
    getDailyForecast(days: number = 5): Array<{
        date: number;
        tempMax: number;
        tempMin: number;
        iconName: string;
        dayName: string;
    }> {
        const list = this.#weather.get_forecast_list();
        if (!list) return [];
        const forecasts = toArray<GWeather.Info>(list);
        if (forecasts.length === 0) return [];

        logger.debug(
            'weather',
            `getDailyForecast: ${forecasts.length} entries, first ts=${forecasts[0].get_value_update()[1]}`
        );

        // Group by day using forecast timestamps
        const dayMap = new Map<string, GWeather.Info[]>();
        for (const f of forecasts) {
            const [valid, ts] = f.get_value_update();
            if (!valid) continue;
            const dt = GLib.DateTime.new_from_unix_local(ts)!;
            const dayKey = dt.format('%Y-%m-%d');
            if (!dayKey) continue;
            if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
            dayMap.get(dayKey)!.push(f);
        }

        logger.debug(
            'weather',
            `getDailyForecast: grouped into ${dayMap.size} days: ${Array.from(dayMap.keys()).join(', ')}`
        );

        // Sort days chronologically and skip today
        const today = GLib.DateTime.new_now_local()!.format('%Y-%m-%d');
        if (!today) return [];
        const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) =>
            a.localeCompare(b)
        );
        const futureDays = sortedDays.filter(([day]) => day > today);

        logger.debug(
            'weather',
            `getDailyForecast: ${futureDays.length} future days after skipping today`
        );

        return futureDays.slice(0, days).map(([_, fs]) => {
            let tempMax = -Infinity;
            let tempMin = Infinity;
            const [, ts] = fs[0].get_value_update();
            const dt = GLib.DateTime.new_from_unix_local(ts)!;
            const midIcon = fs[Math.floor(fs.length / 2)].get_icon_name();

            for (const f of fs) {
                if (!f.is_valid()) continue;
                const [tempValid, tempVal] = f.get_value_temp(
                    GWeather.TemperatureUnit.CENTIGRADE
                );
                if (tempValid) {
                    if (tempVal > tempMax) tempMax = tempVal;
                    if (tempVal < tempMin) tempMin = tempVal;
                }
            }

            return {
                date: ts,
                tempMax: tempMax === -Infinity ? 0 : tempMax,
                tempMin: tempMin === Infinity ? 0 : tempMin,
                iconName: midIcon,
                dayName: dt.format('%a') ?? '---',
            };
        });
    }

    /** Sunrise unix timestamp */
    /** Trigger a network refresh. Widgets call this instead of `weather.info.update()`. */
    refresh() {
        this.#weather.update();
    }

    getSunriseTime(): number {
        const [, ts] = this.#weather.get_value_sunrise();
        return ts;
    }

    /** Sunset unix timestamp */
    getSunsetTime(): number {
        const [, ts] = this.#weather.get_value_sunset();
        return ts;
    }

    /** Moon phase: degrees (0=new, 90=first, 180=full, 270=last) */
    getMoonPhase(): {
        phase: number;
        phaseName: string;
        phaseEmoji: string;
        iconName: string;
    } | null {
        const [valid, phase] = this.#weather.get_value_moonphase();
        if (!valid) return null;
        const d = ((phase % 360) + 360) % 360;
        const idx = Math.round(d / 45) % 8;
        const PHASES = [
            {name: 'New Moon', emoji: '🌑', icon: 'moon-new-symbolic'},
            {
                name: 'Waxing Crescent',
                emoji: '🌒',
                icon: 'moon-waxing-crescent-symbolic',
            },
            {
                name: 'First Quarter',
                emoji: '🌓',
                icon: 'moon-first-quarter-symbolic',
            },
            {
                name: 'Waxing Gibbous',
                emoji: '🌔',
                icon: 'moon-waxing-gibbous-symbolic',
            },
            {name: 'Full Moon', emoji: '🌕', icon: 'moon-full-symbolic'},
            {
                name: 'Waning Gibbous',
                emoji: '🌖',
                icon: 'moon-waning-gibbous-symbolic',
            },
            {
                name: 'Last Quarter',
                emoji: '🌗',
                icon: 'moon-last-quarter-symbolic',
            },
            {
                name: 'Waning Crescent',
                emoji: '🌘',
                icon: 'moon-waning-crescent-symbolic',
            },
        ];
        return {
            phase,
            phaseName: PHASES[idx]!.name,
            phaseEmoji: PHASES[idx]!.emoji,
            iconName: PHASES[idx]!.icon,
        };
    }

    /** Current conditions detail data */
    getDetails(): {
        windSpeed: number;
        windDirection: number;
        humidity: number;
        pressure: number;
    } {
        const [, speed, dir] = this.#weather.get_value_wind(
            GWeather.SpeedUnit.DEFAULT
        );
        const humStr = this.#weather.get_humidity();
        const humidity = humStr ? parseFloat(humStr) : 0;
        const [, pressure] = this.#weather.get_value_pressure(
            GWeather.PressureUnit.HPA
        );
        return {
            windSpeed: speed,
            windDirection: dir,
            humidity,
            pressure,
        };
    }

    constructor() {
        super();

        this.#weather = GWeather.Info.new(null);

        this.#weather.set_application_id(import.meta.domain);
        this.#weather.set_enabled_providers(GWeather.Provider.MET_NO);
        this.#weather.set_contact_info('caiomuniz888@gmail.com');

        this.#generalSettings = new Gio.Settings({
            schemaId: `${import.meta.domain}.general`,
        });

        this.#weatherHandlerId = this.#weather.connect('updated', () => {
            logger.info(
                'weather',
                `updated: valid=${this.#weather.is_valid()}` +
                    ` temp=${this.#weather.get_temp_summary() || 'null'}` +
                    ` sky=${this.#weather.get_sky() || 'null'}` +
                    ` loc=${this.#weather.get_location_name() || 'null'}`
            );
            this.#updateComputed();
            this.notify('info');

            // Persist daytime/sunrise/sunset for other services
            if (this.#weather.is_valid()) {
                const [, sunrise] = this.#weather.get_value_sunrise();
                const [, sunset] = this.#weather.get_value_sunset();
                this.#generalSettings.set_boolean(
                    'weather-is-daytime',
                    this.#weather.is_daytime()
                );
                this.#generalSettings.set_double(
                    'weather-sunrise-time',
                    sunrise
                );
                this.#generalSettings.set_double('weather-sunset-time', sunset);
            }
        });
    }

    dispose() {
        if (this.#weatherHandlerId !== 0) {
            try {
                this.#weather.disconnect(this.#weatherHandlerId);
            } catch {
                /* ignore */
            }
            this.#weatherHandlerId = 0;
        }
        if (this.#updateTimer !== null) {
            GLib.source_remove(this.#updateTimer);
            this.#updateTimer = null;
        }
    }
}

defineService({name: 'Weather', service: Weather.get_default(), initArgs: () => [weatherSettings()]});
