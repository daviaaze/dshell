import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import GWeather from 'gi://GWeather?version=4.0';
import {defineService} from '@shade/core/define';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import type {Accessor} from 'gnim';
import {Object, property, register} from 'gnim/gobject';
import type {Coordinates} from './geolocation';
import Geolocation from './geolocation';
import {weatherSettings} from './weather.gschema';
import {formatTemp} from './weatherUtils';

type UpdateRequest = {
    kind: 'location' | 'refresh';
    location?: GWeather.Location;
    phase: 'starting' | 'waiting';
    resolve: () => void;
    reject: (error: Error) => void;
};

type WeatherDependencies = {
    info?: GWeather.Info;
    geo?: Geolocation;
};

const toError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

@register
export default class Weather extends Object {
    private static instance: Weather;

    static get_default() {
        if (!Weather.instance) Weather.instance = new Weather();
        return Weather.instance;
    }

    #weather: GWeather.Info;
    #location: GWeather.Location | undefined;
    #geo: Geolocation;
    #updateTimer: number | null = null;
    #weatherHandlerId = 0;
    #geoHandlerId: number | null = null;
    #autoLocationUnsubscribe: (() => void) | null = null;
    #drainSourceId: number | null = null;
    #updateQueue: UpdateRequest[];
    #activeUpdate: UpdateRequest | null = null;
    #detectionPromise: Promise<Coordinates> | null = null;
    #detectionReject: ((error: Error) => void) | null = null;
    #detectionGeneration = 0;
    #locationBusy = false;
    #locationError: string | null = null;
    #updateError: string | null = null;
    #disposed = false;
    #initialized = false;
    #generalSettings: Gio.Settings | null = null;

    @property
    get locationBusy() {
        return this.#locationBusy;
    }

    @property
    get locationError() {
        return this.#locationError;
    }

    @property
    get updateBusy() {
        return this.#activeUpdate !== null || this.#updateQueue.length > 0;
    }

    @property
    get updateError() {
        return this.#updateError;
    }

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
            ? formatTemp(w.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE)[1])
            : '--°';
        this.#feelsLike = valid ? `Feels like ${w.get_apparent()}` : '';
        this.#skyDesc = valid ? w.get_sky() : '';
        this.#locationName = w.get_location_name() || '—';
        this.#weatherIcon = w.get_icon_name() || 'weather-none-available-symbolic';

        if (valid) {
            const [, speed, dir] = w.get_value_wind(GWeather.SpeedUnit.DEFAULT);
            this.#windSpeed = speed;
            this.#windDirection = dir;
            const humStr = w.get_humidity();
            this.#humidity = humStr ? parseFloat(humStr) : 0;
            const [, pressure] = w.get_value_pressure(GWeather.PressureUnit.HPA);
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

    #setLocation(location: GWeather.Location): Promise<void> {
        if (this.#disposed) return Promise.reject(new Error('Weather service is disposed'));
        this.#location = location;
        return this.#enqueueUpdate('location', location);
    }

    #enqueueUpdate(kind: UpdateRequest['kind'], location?: GWeather.Location): Promise<void> {
        if (this.#disposed) return Promise.reject(new Error('Weather service is disposed'));

        this.#updateError = null;
        this.notify('update-error');

        const completion = Promise.withResolvers<void>();
        this.#updateQueue.push({
            kind,
            location,
            phase: 'starting',
            resolve: () => completion.resolve(),
            reject: (error) => completion.reject(error),
        });
        this.notify('update-busy');
        this.#drainUpdates();
        return completion.promise;
    }

    #drainUpdates() {
        if (this.#disposed || this.#activeUpdate || this.#drainSourceId !== null) return;
        const request = this.#updateQueue.shift();
        if (!request) return;

        this.#activeUpdate = request;
        this.#updateError = null;
        this.notify('update-error');
        const location = request.kind === 'refresh' ? this.#location : request.location;
        if (!location) {
            this.#finishUpdate(request, new Error('No weather location is available'));
            return;
        }

        try {
            this.#weather.set_location(location);
            if (this.#disposed || this.#activeUpdate !== request) return;
            request.phase = 'waiting';
            this.#weather.update();
        } catch (error) {
            this.#finishUpdate(request, toError(error));
        }
    }

    #finishUpdate(request: UpdateRequest, error?: Error) {
        if (this.#activeUpdate !== request) return;
        this.#activeUpdate = null;
        if (error) {
            this.#updateError = error.message;
            this.notify('update-error');
            request.reject(error);
        } else {
            request.resolve();
        }
        this.notify('update-busy');
        if (this.#updateQueue.length > 0) this.#scheduleUpdateDrain();
    }

    #scheduleUpdateDrain() {
        if (this.#disposed || this.#drainSourceId !== null || this.#updateQueue.length === 0) return;
        this.#drainSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.#drainSourceId = null;
            this.#drainUpdates();
            return GLib.SOURCE_REMOVE;
        });
    }

    #onWeatherUpdated() {
        if (this.#disposed) return;
        logger.info(
            'weather',
            `updated: valid=${this.#weather.is_valid()}` +
                ` temp=${this.#weather.get_temp_summary() || 'null'}` +
                ` sky=${this.#weather.get_sky() || 'null'}` +
                ` loc=${this.#weather.get_location_name() || 'null'}`
        );
        this.#updateComputed();
        this.notify('info');

        if (this.#weather.is_valid() && this.#generalSettings) {
            const [, sunrise] = this.#weather.get_value_sunrise();
            const [, sunset] = this.#weather.get_value_sunset();
            this.#generalSettings.set_boolean('weather-is-daytime', this.#weather.is_daytime());
            this.#generalSettings.set_double('weather-sunrise-time', sunrise);
            this.#generalSettings.set_double('weather-sunset-time', sunset);
        }

        const request = this.#activeUpdate;
        if (!request || request.phase !== 'waiting') return;
        try {
            if (this.#weather.network_error()) {
                this.#finishUpdate(request, new Error('Weather update failed due to a network error'));
            } else if (!this.#weather.is_valid()) {
                this.#finishUpdate(request, new Error('Weather data is invalid'));
            } else {
                this.#finishUpdate(request);
            }
        } catch (error) {
            this.#finishUpdate(request, toError(error));
        }
    }

    set location(location: GWeather.Location | undefined) {
        if (!location || this.#disposed) return;
        void this.#setLocation(location).catch((error: unknown) => {
            logger.error('weather', 'Location update failed:', error);
        });
    }

    async updateFromCoords(lat: number, lon: number): Promise<void> {
        if (this.#disposed) throw new Error('Weather service is disposed');
        const location = GWeather.Location.get_world()?.find_nearest_city(lat, lon);
        if (!location) {
            const error = new Error('Could not find a weather location for these coordinates');
            this.#updateError = error.message;
            this.notify('update-error');
            throw error;
        }
        await this.#setLocation(location);
    }

    detectLocation(): Promise<Coordinates> {
        if (this.#disposed) return Promise.reject(new Error('Weather service is disposed'));
        if (this.#detectionPromise) return this.#detectionPromise;

        this.#locationError = null;
        this.#locationBusy = true;
        this.notify('location-error');
        this.notify('location-busy');
        const generation = ++this.#detectionGeneration;
        const completion = Promise.withResolvers<Coordinates>();
        this.#detectionPromise = completion.promise;
        this.#detectionReject = completion.reject;

        let result: Promise<Coordinates>;
        try {
            result = this.#geo.detect();
        } catch (error) {
            result = Promise.reject(error);
        }
        Promise.resolve(result).then(
            (coordinates) => {
                if (this.#disposed || generation !== this.#detectionGeneration) return;
                this.#detectionPromise = null;
                this.#detectionReject = null;
                this.#locationBusy = false;
                this.notify('location-busy');
                completion.resolve(coordinates);
            },
            (error: unknown) => {
                if (this.#disposed || generation !== this.#detectionGeneration) return;
                const failure = toError(error);
                this.#detectionPromise = null;
                this.#detectionReject = null;
                this.#locationBusy = false;
                this.#locationError = failure.message;
                this.notify('location-busy');
                this.notify('location-error');
                completion.reject(failure);
            }
        );
        return completion.promise;
    }

    refresh(): Promise<void> {
        return this.#enqueueUpdate('refresh');
    }

    init(settings: {
        latitude: Accessor<number>;
        longitude: Accessor<number>;
        autoLocation: Accessor<boolean>;
        setLatitude(lat: number): void;
        setLongitude(lon: number): void;
    }) {
        if (this.#disposed) return;
        if (this.#initialized) {
            logger.warn('weather', 'init() called but already initialized — skipping');
            return;
        }
        this.#initialized = true;
        this.#generalSettings = new Gio.Settings({
            schemaId: `${import.meta.domain}.general`,
        });
        this.#location = GWeather.Location.get_world()?.find_nearest_city(
            settings.latitude(),
            settings.longitude()
        );

        if (this.#location) {
            void this.#enqueueUpdate('location', this.#location).catch((error: unknown) => {
                logger.error('weather', 'Initial weather update failed:', error);
            });
        }

        // Keep the existing 30-minute cadence.
        this.#updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0.5 * 3600000, () => {
            if (!this.#disposed) {
                void this.refresh().catch((error: unknown) => {
                    logger.error('weather', 'Scheduled weather update failed:', error);
                });
            }
            return this.#disposed ? GLib.SOURCE_REMOVE : GLib.SOURCE_CONTINUE;
        });

        const connectGeo = () => {
            if (this.#geoHandlerId !== null) {
                this.#geo.disconnect(this.#geoHandlerId);
                this.#geoHandlerId = null;
            }
            this.#geoHandlerId = GObject.signal_connect(
                this.#geo,
                'location-changed',
                (_source: Geolocation, ...args: unknown[]) => {
                    if (this.#disposed) return;
                    const lat = args[0] as number;
                    const lon = args[1] as number;
                    settings.setLatitude(lat);
                    settings.setLongitude(lon);
                    void this.updateFromCoords(lat, lon).catch((error: unknown) => {
                        logger.error('weather', 'Automatic weather update failed:', error);
                    });
                }
            );
        };

        const detectAutomatically = () => {
            void this.detectLocation().catch((error: unknown) => {
                logger.error('weather', 'Automatic location detection failed:', error);
            });
        };

        if (settings.autoLocation()) {
            connectGeo();
            detectAutomatically();
        }

        this.#autoLocationUnsubscribe = settings.autoLocation.subscribe(() => {
            if (this.#disposed) return;
            if (settings.autoLocation()) {
                connectGeo();
                detectAutomatically();
            } else if (this.#geoHandlerId !== null) {
                this.#geo.disconnect(this.#geoHandlerId);
                this.#geoHandlerId = null;
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

        logger.debug('weather', `getHourlyForecast: found ${forecasts.length} forecast entries`);

        const future = forecasts.filter((f) => {
            const [valid, ts] = f.get_value_update();
            return valid && ts > now;
        });

        logger.debug(
            'weather',
            `getHourlyForecast: ${future.length} future entries, first in ${future.length > 0 ? future[0].get_value_update()[1] - now : 0}s`
        );

        return future.slice(0, hours).map((f) => {
            const [, ts] = f.get_value_update();
            const isValid = f.is_valid();
            let temp = NaN;
            if (isValid) {
                const [tempValid, tempVal] = f.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
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
        const sortedDays = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
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
                const [tempValid, tempVal] = f.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
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
        const [, speed, dir] = this.#weather.get_value_wind(GWeather.SpeedUnit.DEFAULT);
        const humStr = this.#weather.get_humidity();
        const humidity = humStr ? parseFloat(humStr) : 0;
        const [, pressure] = this.#weather.get_value_pressure(GWeather.PressureUnit.HPA);
        return {
            windSpeed: speed,
            windDirection: dir,
            humidity,
            pressure,
        };
    }

    constructor(dependencies: WeatherDependencies = {}) {
        super();

        this.#updateQueue = [];
        this.#geo = dependencies.geo ?? Geolocation.get_default();
        this.#weather = dependencies.info ?? GWeather.Info.new(null);

        this.#weather.set_application_id(import.meta.domain);
        this.#weather.set_enabled_providers(GWeather.Provider.MET_NO);
        this.#weather.set_contact_info('caiomuniz888@gmail.com');

        this.#weatherHandlerId = this.#weather.connect('updated', () => {
            this.#onWeatherUpdated();
        });
    }

    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#detectionGeneration++;

        if (this.#updateTimer !== null) {
            GLib.source_remove(this.#updateTimer);
            this.#updateTimer = null;
        }
        if (this.#drainSourceId !== null) {
            GLib.source_remove(this.#drainSourceId);
            this.#drainSourceId = null;
        }
        if (this.#autoLocationUnsubscribe) {
            try {
                this.#autoLocationUnsubscribe();
            } catch (error) {
                logger.warn('weather', 'Could not disconnect auto-location settings:', error);
            }
            this.#autoLocationUnsubscribe = null;
        }
        if (this.#geoHandlerId !== null) {
            try {
                this.#geo.disconnect(this.#geoHandlerId);
            } catch (error) {
                logger.warn('weather', 'Could not disconnect geolocation listener:', error);
            }
            this.#geoHandlerId = null;
        }

        const disposedError = new Error('Weather service is disposed');
        const active = this.#activeUpdate;
        this.#activeUpdate = null;
        active?.reject(disposedError);
        for (const request of this.#updateQueue.splice(0)) {
            request.reject(disposedError);
        }
        this.notify('update-busy');

        const rejectDetection = this.#detectionReject;
        this.#detectionPromise = null;
        this.#detectionReject = null;
        this.#locationBusy = false;
        this.notify('location-busy');
        rejectDetection?.(disposedError);

        if (this.#weatherHandlerId !== 0) {
            try {
                this.#weather.disconnect(this.#weatherHandlerId);
            } catch (error) {
                logger.warn('weather', 'Could not disconnect weather listener:', error);
            }
            this.#weatherHandlerId = 0;
        }
        try {
            this.#weather.abort();
        } catch (error) {
            logger.warn('weather', 'Could not abort weather update during disposal:', error);
        }
    }
}

let initializedWeather: Weather | null = null;
defineService({
    name: 'Weather',
    service: {
        init(settings: Parameters<Weather['init']>[0]) {
            initializedWeather = Weather.get_default();
            initializedWeather.init(settings);
        },
        dispose() {
            initializedWeather?.dispose();
            initializedWeather = null;
        },
    },
    initArgs: () => [weatherSettings()],
});
