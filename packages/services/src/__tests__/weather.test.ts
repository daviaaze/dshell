/**
 * Weather service and pure location-domain helper tests.
 *
 * Every exercised Weather uses injected fake Info/geolocation providers.
 * Importing the service does not construct GWeather.Info; registration creates
 * the production instance only when services initialize under GApplication.
 */
import GLib from 'gi://GLib?version=2.0';
import type GWeather from 'gi://GWeather?version=4.0';
import {formatTemp, isDaytime, sunAngle, windDirectionLabel} from '../location/weatherUtils';
import type {Coordinates} from '../location/geolocation';
import {describe, expect, it, run} from './test-runner';

import Weather from '../location/weather';
type WeatherOptions = NonNullable<ConstructorParameters<typeof Weather>[0]>;

class FakeInfo {
    #handlers = new Map<number, (...args: unknown[]) => void>();
    #nextHandlerId = 1;
    currentLocation: GWeather.Location | null = null;
    readonly assignedLocations: GWeather.Location[] = [];
    readonly startedLocations: GWeather.Location[] = [];
    valid = true;
    networkError = false;
    emitOnSetLocation = false;
    throwOnUpdate = false;
    abortCount = 0;

    connect(_signal: string, callback: (...args: unknown[]) => void): number {
        const id = this.#nextHandlerId++;
        this.#handlers.set(id, callback);
        return id;
    }

    disconnect(id: number) {
        this.#handlers.delete(id);
    }

    set_location(location: GWeather.Location) {
        this.currentLocation = location;
        this.assignedLocations.push(location);
        if (this.emitOnSetLocation) this.emitUpdated();
    }

    update() {
        if (this.throwOnUpdate) throw new Error('native update could not start');
        if (!this.currentLocation) throw new Error('no location assigned');
        this.startedLocations.push(this.currentLocation);
    }
    set_application_id(_applicationId: string) {}

    set_enabled_providers(_providers: number) {}

    set_contact_info(_contactInfo: string) {}

    abort() {
        this.abortCount++;
    }

    emitUpdated() {
        for (const callback of this.#handlers.values()) callback();
    }

    is_valid() {
        return this.valid;
    }

    network_error() {
        return this.networkError;
    }

    get_temp_summary() {
        return '20°';
    }

    get_value_temp() {
        return [true, 20] as [boolean, number];
    }

    get_apparent() {
        return '20°';
    }

    get_sky() {
        return 'Clear';
    }

    get_location_name() {
        return 'Test location';
    }

    get_icon_name() {
        return 'weather-clear';
    }

    get_value_wind() {
        return [true, 1, 1] as [boolean, number, number];
    }

    get_humidity() {
        return '50';
    }

    get_value_pressure() {
        return [true, 1013] as [boolean, number];
    }

    get_value_sunrise() {
        return [true, 1000] as [boolean, number];
    }

    get_value_sunset() {
        return [true, 2000] as [boolean, number];
    }
}

function createWeather(
    info: FakeInfo,
    geo: {detect: () => Promise<Coordinates>} = {
        detect: () => Promise.resolve({latitude: 0, longitude: 0}),
    }
) {
    return new Weather({
        info: info as unknown as GWeather.Info,
        geo: geo as unknown as WeatherOptions['geo'],
    });
}

function waitForMainContext(): Promise<void> {
    const turn = Promise.withResolvers<void>();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        turn.resolve();
        return GLib.SOURCE_REMOVE;
    });
    return turn.promise;
}

async function expectRejected(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
    throw new Error('Expected promise to reject');
}

describe('weatherUtils', () => {
    it('formatTemp appends the degree symbol and rounds', () => {
        expect(formatTemp(24.4)).toBe('24°');
        expect(formatTemp(24.6)).toBe('25°');
    });

    it('windDirectionLabel maps the GWeather enum to compass abbreviations', () => {
        expect(windDirectionLabel(-1)).toBe('—'); // INVALID
        expect(windDirectionLabel(0)).toBe('—'); // VARIABLE
        expect(windDirectionLabel(1)).toBe('N');
        expect(windDirectionLabel(5)).toBe('E');
        expect(windDirectionLabel(16)).toBe('NNW');
        expect(windDirectionLabel(99)).toBe('—'); // out of range
    });

    it('sunAngle returns -1 outside daylight hours', () => {
        expect(sunAngle(3600, 7200, 3500)).toBe(-1); // before sunrise
        expect(sunAngle(3600, 7200, 7300)).toBe(-1); // after sunset
        expect(sunAngle(-1, 7200, 5000)).toBe(-1); // invalid sunrise
        expect(sunAngle(3600, 3600, 5000)).toBe(-1); // zero day length
    });

    it('sunAngle peaks at noon and is 0 at the edges', () => {
        expect(sunAngle(100, 10000, 5050)).toBeGreaterThan(0.99); // ~1 at noon
        expect(sunAngle(100, 10000, 100)).toBeLessThan(0.001); // ~0 at sunrise
        expect(sunAngle(100, 10000, 10000)).toBeLessThan(0.001); // ~0 at sunset
    });

    it('isDaytime is true between sunrise and sunset, inclusive', () => {
        expect(isDaytime(3600, 7200, 3600)).toBe(true); // at sunrise
        expect(isDaytime(3600, 7200, 5400)).toBe(true); // midday
        expect(isDaytime(3600, 7200, 7200)).toBe(true); // at sunset
        expect(isDaytime(3600, 7200, 3599)).toBe(false); // just before
        expect(isDaytime(3600, 7200, 7201)).toBe(false); // just after
    });
});

describe('Weather completion queue', () => {
    it.async('does not settle a request from an updated signal while starting', async () => {
        const info = new FakeInfo();
        info.emitOnSetLocation = true;
        const weather = createWeather(info);
        const update = weather.updateFromCoords(40.7128, -74.006);
        let settled = false;
        void update.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            }
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(info.startedLocations.length).toBe(1);

        info.emitOnSetLocation = false;
        info.emitUpdated();
        await update;
        expect(settled).toBe(true);
        weather.dispose();
    });

    it.async('serializes requests and refreshes at the location current when it starts', async () => {
        const info = new FakeInfo();
        const weather = createWeather(info);
        const first = weather.updateFromCoords(40.7128, -74.006);
        const firstLocation = info.startedLocations[0];
        const refresh = weather.refresh();
        const changedLocation = weather.updateFromCoords(35.6762, 139.6503);
        expect(info.startedLocations.length).toBe(1);
        expect(info.assignedLocations.length).toBe(1);
        expect(weather.updateBusy).toBe(true);

        info.emitUpdated();
        info.emitUpdated(); // A duplicate predecessor signal before the deferred drain.
        await first;
        expect(info.startedLocations.length).toBe(1);
        await waitForMainContext();

        expect(info.startedLocations.length).toBe(2);
        expect(info.startedLocations[1] === firstLocation).toBe(false);
        expect(info.assignedLocations.length).toBe(2);
        expect(info.assignedLocations[1] === info.startedLocations[1]).toBe(true);
        info.emitUpdated();
        await refresh;
        await waitForMainContext();

        expect(info.startedLocations.length).toBe(3);
        expect(info.startedLocations[2] === info.startedLocations[1]).toBe(true);
        expect(info.assignedLocations.length).toBe(3);
        expect(info.assignedLocations[2] === info.startedLocations[2]).toBe(true);
        info.emitUpdated();
        await changedLocation;
        expect(weather.updateBusy).toBe(false);
        weather.dispose();
    });

    it.async('rejects network errors before invalid data and catches native start failures', async () => {
        const networkInfo = new FakeInfo();
        networkInfo.valid = false;
        networkInfo.networkError = true;
        const networkWeather = createWeather(networkInfo);
        const networkFailure = expectRejected(networkWeather.updateFromCoords(40.7128, -74.006));
        networkInfo.emitUpdated();
        expect((await networkFailure).message).toBe('Weather update failed due to a network error');
        networkWeather.dispose();

        const invalidInfo = new FakeInfo();
        invalidInfo.valid = false;
        const invalidWeather = createWeather(invalidInfo);
        const invalidFailure = expectRejected(invalidWeather.updateFromCoords(40.7128, -74.006));
        invalidInfo.emitUpdated();
        expect((await invalidFailure).message).toBe('Weather data is invalid');
        invalidWeather.dispose();

        const startFailureInfo = new FakeInfo();
        startFailureInfo.throwOnUpdate = true;
        const startFailureWeather = createWeather(startFailureInfo);
        const startFailure = await expectRejected(
            startFailureWeather.updateFromCoords(40.7128, -74.006)
        );
        expect(startFailure.message).toBe('native update could not start');
        expect(startFailureWeather.updateBusy).toBe(false);
        expect(startFailureWeather.updateError).toBe('native update could not start');
        startFailureWeather.dispose();
    });

    it.async('rejects refresh without a location and reports detection failure', async () => {
        const noLocationInfo = new FakeInfo();
        const noLocationWeather = createWeather(noLocationInfo);
        const noLocation = await expectRejected(noLocationWeather.refresh());
        expect(noLocation.message).toBe('No weather location is available');
        expect(noLocationInfo.startedLocations.length).toBe(0);
        expect(noLocationWeather.updateBusy).toBe(false);
        expect(noLocationWeather.updateError).toBe('No weather location is available');
        noLocationWeather.dispose();

        const detectionWeather = createWeather(new FakeInfo(), {
            detect: () => Promise.reject(new Error('location provider unavailable')),
        });
        const detectionFailure = await expectRejected(detectionWeather.detectLocation());
        expect(detectionFailure.message).toBe('location provider unavailable');
        expect(detectionWeather.locationBusy).toBe(false);
        expect(detectionWeather.locationError).toBe('location provider unavailable');
        detectionWeather.dispose();
    });

    it.async('coalesces location detection and exposes truthful busy/error state', async () => {
        const detection = Promise.withResolvers<Coordinates>();
        let detectCalls = 0;
        const weather = createWeather(new FakeInfo(), {
            detect: () => {
                detectCalls++;
                return detection.promise;
            },
        });

        const first = weather.detectLocation();
        const second = weather.detectLocation();
        expect(first).toBe(second);
        expect(detectCalls).toBe(1);
        expect(weather.locationBusy).toBe(true);
        expect(weather.locationError).toBeNull();

        const coordinates = {latitude: 51.5072, longitude: -0.1276};
        detection.resolve(coordinates);
        expect(await first).toBe(coordinates);
        expect(weather.locationBusy).toBe(false);
        expect(weather.locationError).toBeNull();
        weather.dispose();
    });

    it.async('rejects active, queued and detecting work immediately on disposal', async () => {
        const detection = Promise.withResolvers<Coordinates>();
        const info = new FakeInfo();
        const weather = createWeather(info, {detect: () => detection.promise});
        const active = weather.updateFromCoords(40.7128, -74.006);
        const queued = weather.updateFromCoords(35.6762, 139.6503);
        const detecting = weather.detectLocation();
        const outcomes = Promise.allSettled([active, queued, detecting]);

        weather.dispose();
        const settled = await outcomes;
        expect(settled.map((result) => result.status)).toEqual([
            'rejected',
            'rejected',
            'rejected',
        ]);
        expect(info.abortCount).toBe(1);
        expect(weather.updateBusy).toBe(false);
        expect(weather.locationBusy).toBe(false);

        detection.resolve({latitude: 51.5072, longitude: -0.1276});
        await waitForMainContext();
        expect(info.startedLocations.length).toBe(1);
        expect(info.abortCount).toBe(1);
    });
});

await run(import.meta.url);
