import {
    Object,
    register,
    signal,
    property,
    Double,
    VoidType,
    Int,
} from 'gnim/gobject';
import {Process} from '../../core/process';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import logger from '../../core/logger';

@register
export default class Geolocation extends Object {
    static instance: Geolocation;

    static get_default() {
        if (!this.instance) this.instance = new Geolocation();
        return this.instance;
    }

    #latitude = 0;
    #longitude = 0;
    #available = false;
    #detecting = false;

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

    detect() {
        if (this.#detecting) return;
        this.#detecting = true;
        this.#tryGeoClue()
            .then(found => {
                this.#detecting = false;
                if (!found) this.#tryIpGeolocation();
            })
            .catch(e => {
                this.#detecting = false;
                logger.error('geo', 'GeoClue detection failed:', e);
                this.#tryIpGeolocation();
            });
    }

    async #createDbusProxy(
        bus: Gio.BusType,
        name: string,
        objectPath: string,
        interfaceName: string,
        errorLabel: string
    ): Promise<Gio.DBusProxy> {
        return new Promise<Gio.DBusProxy>((resolve, reject) => {
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
        });
    }

    #getGeoClueClientPath(proxy: Gio.DBusProxy): string | null {
        const result = proxy
            .call_sync('GetClient', null, Gio.DBusCallFlags.NONE, -1, null)
            ?.get_child_value(0)
            ?.get_string()?.[0];
        return result ?? null;
    }

    #configureGeoClueClient(client: Gio.DBusProxy, clientPath: string): void {
        const conn = client.get_connection();
        const setProp = (iface: string, prop: string, value: GLib.Variant) => {
            conn.call_sync(
                'org.freedesktop.GeoClue2',
                clientPath,
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [iface, prop, value]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
        };
        setProp(
            'org.freedesktop.GeoClue2.Client',
            'DesktopId',
            new GLib.Variant('s', 'com.caioasmuniz.shade_shell')
        );
        setProp(
            'org.freedesktop.GeoClue2.Client',
            'RequestedAccuracyLevel',
            new GLib.Variant('u', 4)
        );
    }

    #connectGeoClueLocationSignal(client: Gio.DBusProxy): {
        signalId: number;
        latestLocation: string | null;
    } {
        let latestLocation: string | null = null;
        const signalId = client.connect(
            'g-signal',
            (_proxy, _sender, signalName, params) => {
                if (signalName === 'LocationUpdated') {
                    const newPath = params.get_child_value(1).get_string()?.[0];
                    logger.debug('geo', `LocationUpdated signal: ${newPath}`);
                    if (newPath && newPath !== '/') latestLocation = newPath;
                }
            }
        );
        return {signalId, latestLocation};
    }

    async #startGeoClueClient(client: Gio.DBusProxy): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            client.call(
                'Start',
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (_, res) => {
                    try {
                        client.call_finish(res);
                        logger.debug('geo', 'Start succeeded');
                        resolve();
                    } catch (e) {
                        logger.error('geo', 'Start failed:', e);
                        reject(e);
                    }
                }
            );
        });
    }

    async #waitForGeoClueLocation(
        client: Gio.DBusProxy,
        latestLocationRef: {latestLocation: string | null}
    ): Promise<string | null> {
        for (let i = 0; i < 60; i++) {
            if (
                latestLocationRef.latestLocation &&
                latestLocationRef.latestLocation !== '/'
            ) {
                return latestLocationRef.latestLocation;
            }
            const cached =
                client.get_cached_property('Location')?.get_string()?.[0] ??
                null;
            if (cached && cached !== '/') return cached;
            await new Promise<void>(r =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    r();
                    return GLib.SOURCE_REMOVE;
                })
            );
        }
        return null;
    }

    async #tryGeoClue(): Promise<boolean> {
        let client: Gio.DBusProxy | null = null;
        try {
            const manager = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                'org.freedesktop.GeoClue2',
                '/org/freedesktop/GeoClue2/Manager',
                'org.freedesktop.GeoClue2.Manager',
                'Manager proxy failed'
            );

            const clientPath = this.#getGeoClueClientPath(manager);
            if (!clientPath) {
                logger.warn('geo', 'GetClient returned no path');
                return false;
            }

            client = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                'org.freedesktop.GeoClue2',
                clientPath,
                'org.freedesktop.GeoClue2.Client',
                'Client proxy failed'
            );

            this.#configureGeoClueClient(client, clientPath);

            const {signalId, latestLocation} =
                this.#connectGeoClueLocationSignal(client);
            const latestLocationRef = {latestLocation};

            await this.#startGeoClueClient(client);

            const locationPath = await this.#waitForGeoClueLocation(
                client,
                latestLocationRef
            );

            if (signalId) client.disconnect(signalId);

            if (!locationPath) {
                logger.warn('geo', 'No location path after retries');
                return false;
            }

            logger.debug('geo', `Creating Location proxy for ${locationPath}`);
            const location = await this.#createDbusProxy(
                Gio.BusType.SYSTEM,
                'org.freedesktop.GeoClue2',
                locationPath,
                'org.freedesktop.GeoClue2.Location',
                'Location proxy failed'
            );

            const lat =
                location.get_cached_property('Latitude')?.get_double() ?? 0;
            const lon =
                location.get_cached_property('Longitude')?.get_double() ?? 0;
            logger.info('geo', `coordinates lat=${lat} lon=${lon}`);

            this.#update(lat, lon);
            return true;
        } catch (e) {
            logger.error('geo', 'GeoClue detection failed:', e);
            return false;
        } finally {
            if (client) {
                try {
                    client.call_sync(
                        'Stop',
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null
                    );
                } catch {
                    /* ignore */
                }
            }
        }
    }

    #tryIpGeolocation() {
        Process.execAsyncv([
            'curl',
            '-s',
            '--max-time',
            '5',
            'https://ipapi.co/json/',
        ])
            .then(out => {
                if (!out) {
                    logger.warn('geo', 'curl produced no output');
                    return;
                }
                const data = JSON.parse(out);
                if (!data) {
                    logger.warn('geo', 'parsed response is null');
                    return;
                }
                if (
                    typeof data.latitude === 'number' &&
                    typeof data.longitude === 'number'
                ) {
                    this.#update(data.latitude, data.longitude);
                } else {
                    logger.warn(
                        'geo',
                        `no coordinates in response: ${out.slice(0, 200)}`
                    );
                }
            })
            .catch(e => {
                logger.error('geo', 'IP geolocation failed:', e);
            });
    }

    #update(lat: number, lon: number) {
        if (this.#latitude === lat && this.#longitude === lon) return;
        this.#latitude = lat;
        this.#longitude = lon;
        this.#available = true;
        this.notify('latitude');
        this.notify('longitude');
        this.notify('available');
        this.locationChanged(lat, lon);
    }
}
