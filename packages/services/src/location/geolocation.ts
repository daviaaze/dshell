import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register, signal} from 'gnim/gobject';
import {isUsableCoordinates} from './weatherUtils';

const GEOCLUE_BUS = 'org.freedesktop.GeoClue2';
const GEOCLUE_CLIENT_IFACE = 'org.freedesktop.GeoClue2.Client';
const GEOCLUE_CALL_TIMEOUT_MS = 10_000;

export interface Coordinates {
    latitude: number;
    longitude: number;
}

@register
export default class Geolocation extends Object {
    private static instance: Geolocation;

    static get_default() {
        if (!Geolocation.instance) Geolocation.instance = new Geolocation();
        return Geolocation.instance;
    }

    #latitude = 0;
    #longitude = 0;
    #available = false;
    #detection: Promise<Coordinates> | null = null;

    @property
    get latitude() {
        return this.#latitude;
    }

    @property
    get longitude() {
        return this.#longitude;
    }

    @property
    get available() {
        return this.#available;
    }

    @signal
    locationChanged(_lat: number, _lon: number): void {}

    /**
     * Detect the current location through GeoClue. Only when `allowIpFallback` is true
     * and GeoClue fails does this send the public IP to a third-party lookup service.
     */
    detect(allowIpFallback = false): Promise<Coordinates> {
        if (this.#detection) return this.#detection;

        let detection: Promise<Coordinates>;
        detection = this.#runDetection(allowIpFallback).finally(() => {
            if (this.#detection === detection) this.#detection = null;
        });
        this.#detection = detection;
        return detection;
    }

    async #runDetection(allowIpFallback: boolean): Promise<Coordinates> {
        if (await this.#tryGeoClue()) {
            return {latitude: this.#latitude, longitude: this.#longitude};
        }
        if (!allowIpFallback) {
            throw new Error(
                'Não foi possível obter a localização pelo GeoClue e a detecção por IP está desativada.'
            );
        }
        return await this.#tryIpGeolocation();
    }

    async #createDbusProxy(
        bus: Gio.BusType,
        name: string,
        objectPath: string,
        interfaceName: string,
        errorLabel: string
    ): Promise<Gio.DBusProxy> {
        const {promise, resolve, reject} = Promise.withResolvers<Gio.DBusProxy>();
        Gio.DBusProxy.new_for_bus(
            bus,
            Gio.DBusProxyFlags.NONE,
            null,
            name,
            objectPath,
            interfaceName,
            null,
            (_, res) => {
                try {
                    resolve(Gio.DBusProxy.new_for_bus_finish(res));
                } catch (e) {
                    logger.error('geo', `${errorLabel}:`, e);
                    reject(e);
                }
            }
        );
        return promise;
    }

    /** Asynchronous proxy method call bounded by GEOCLUE_CALL_TIMEOUT_MS. */
    #callProxy(
        proxy: Gio.DBusProxy,
        method: string,
        parameters: GLib.Variant | null
    ): Promise<GLib.Variant> {
        const {promise, resolve, reject} = Promise.withResolvers<GLib.Variant>();
        proxy.call(
            method,
            parameters,
            Gio.DBusCallFlags.NONE,
            GEOCLUE_CALL_TIMEOUT_MS,
            null,
            (_, res) => {
                try {
                    resolve(proxy.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            }
        );
        return promise;
    }

    async #getGeoClueClientPath(manager: Gio.DBusProxy): Promise<string | null> {
        const reply = await this.#callProxy(manager, 'GetClient', null);
        return reply.get_child_value(0)?.get_string()?.[0] ?? null;
    }

    async #configureGeoClueClient(client: Gio.DBusProxy, clientPath: string): Promise<void> {
        const conn = client.get_connection();
        const setProp = (prop: string, value: GLib.Variant) => {
            const {promise, resolve, reject} = Promise.withResolvers<void>();
            conn.call(
                GEOCLUE_BUS,
                clientPath,
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [GEOCLUE_CLIENT_IFACE, prop, value]),
                null,
                Gio.DBusCallFlags.NONE,
                GEOCLUE_CALL_TIMEOUT_MS,
                null,
                (_, res) => {
                    try {
                        conn.call_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            );
            return promise;
        };
        await setProp('DesktopId', new GLib.Variant('s', 'com.caioasmuniz.shade_shell'));
        await setProp('RequestedAccuracyLevel', new GLib.Variant('u', 4));
    }

    #connectGeoClueLocationSignal(
        client: Gio.DBusProxy,
        ref: {latestLocation: string | null}
    ): number {
        const signalId = client.connect('g-signal', (_proxy, _sender, signalName, params) => {
            if (signalName === 'LocationUpdated') {
                const newPath = params.get_child_value(1).get_string()?.[0];
                logger.debug('geo', `LocationUpdated signal: ${newPath}`);
                if (newPath && newPath !== '/') ref.latestLocation = newPath;
            }
        });
        return signalId;
    }

    async #startGeoClueClient(client: Gio.DBusProxy): Promise<void> {
        try {
            await this.#callProxy(client, 'Start', null);
            logger.debug('geo', 'Start succeeded');
        } catch (e) {
            logger.error('geo', 'Start failed:', e);
            throw e;
        }
    }

    async #waitForGeoClueLocation(
        client: Gio.DBusProxy,
        latestLocationRef: {latestLocation: string | null}
    ): Promise<string | null> {
        for (let i = 0; i < 60; i++) {
            if (latestLocationRef.latestLocation && latestLocationRef.latestLocation !== '/') {
                return latestLocationRef.latestLocation;
            }
            const cached = client.get_cached_property('Location')?.get_string()?.[0] ?? null;
            if (cached && cached !== '/') return cached;
            const tick = Promise.withResolvers<void>();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                tick.resolve();
                return GLib.SOURCE_REMOVE;
            });
            await tick.promise;
        }
        return null;
    }

    /** Stop the client and delete it from the manager so GeoClue does not accumulate clients. */
    async #releaseGeoClueClient(
        manager: Gio.DBusProxy,
        client: Gio.DBusProxy | null,
        clientPath: string
    ): Promise<void> {
        if (client) {
            try {
                await this.#callProxy(client, 'Stop', null);
            } catch (e) {
                logger.debug('geo', 'Stop failed:', e);
            }
        }
        try {
            await this.#callProxy(manager, 'DeleteClient', new GLib.Variant('(o)', [clientPath]));
        } catch (e) {
            logger.debug('geo', 'DeleteClient failed:', e);
        }
    }

    async #tryGeoClue(): Promise<boolean> {
        let manager: Gio.DBusProxy | null = null;
        let clientPath: string | null = null;
        let client: Gio.DBusProxy | null = null;
        let signalId = 0;
        try {
            manager = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                GEOCLUE_BUS,
                '/org/freedesktop/GeoClue2/Manager',
                'org.freedesktop.GeoClue2.Manager',
                'Manager proxy failed'
            );

            clientPath = await this.#getGeoClueClientPath(manager);
            if (!clientPath) {
                logger.warn('geo', 'GetClient returned no path');
                return false;
            }

            client = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                GEOCLUE_BUS,
                clientPath,
                GEOCLUE_CLIENT_IFACE,
                'Client proxy failed'
            );

            await this.#configureGeoClueClient(client, clientPath);

            const latestLocationRef: {latestLocation: string | null} = {latestLocation: null};
            signalId = this.#connectGeoClueLocationSignal(client, latestLocationRef);

            await this.#startGeoClueClient(client);

            const locationPath = await this.#waitForGeoClueLocation(client, latestLocationRef);

            if (!locationPath) {
                logger.warn('geo', 'No location path after retries');
                return false;
            }

            logger.debug('geo', `Creating Location proxy for ${locationPath}`);
            const location = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                GEOCLUE_BUS,
                locationPath,
                'org.freedesktop.GeoClue2.Location',
                'Location proxy failed'
            );

            const lat = location.get_cached_property('Latitude')?.get_double();
            const lon = location.get_cached_property('Longitude')?.get_double();
            if (lat === undefined || lon === undefined || !isUsableCoordinates(lat, lon)) {
                logger.warn('geo', 'GeoClue location had no usable coordinates');
                return false;
            }
            logger.debug('geo', `coordinates lat=${lat.toFixed(1)} lon=${lon.toFixed(1)}`);

            this.#update(lat, lon);
            return true;
        } catch (e) {
            logger.error('geo', 'GeoClue detection failed:', e);
            return false;
        } finally {
            if (client && signalId) client.disconnect(signalId);
            if (manager && clientPath)
                await this.#releaseGeoClueClient(manager, client, clientPath);
        }
    }

    /** Third-party lookup: sends the public IP to ipapi.co. Only reached when the user opted in. */
    async #tryIpGeolocation(): Promise<Coordinates> {
        try {
            const out = await Process.execAsyncv([
                'curl',
                '-s',
                '--max-time',
                '5',
                'https://ipapi.co/json/',
            ]);
            if (!out) throw new Error('IP geolocation returned no response');

            const data: unknown = JSON.parse(out);
            if (
                typeof data !== 'object' ||
                data === null ||
                !('latitude' in data) ||
                !('longitude' in data) ||
                typeof data.latitude !== 'number' ||
                typeof data.longitude !== 'number' ||
                !isUsableCoordinates(data.latitude, data.longitude)
            ) {
                throw new Error('IP geolocation response did not contain usable coordinates');
            }

            const coordinates = {
                latitude: data.latitude,
                longitude: data.longitude,
            };
            this.#update(coordinates.latitude, coordinates.longitude);
            return coordinates;
        } catch (e) {
            logger.error('geo', 'IP geolocation failed:', e);
            throw e;
        }
    }

    #update(lat: number, lon: number) {
        const coordinatesChanged = this.#latitude !== lat || this.#longitude !== lon;
        const becameAvailable = !this.#available;
        if (!coordinatesChanged && !becameAvailable) return;

        this.#latitude = lat;
        this.#longitude = lon;
        this.#available = true;
        if (coordinatesChanged) {
            this.notify('latitude');
            this.notify('longitude');
        }
        if (becameAvailable) this.notify('available');
        this.locationChanged(lat, lon);
    }
}
