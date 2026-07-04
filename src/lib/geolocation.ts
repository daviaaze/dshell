import GObject, {getter, register, signal} from 'gnim/gobject';
import {Process} from '#/lib/process';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import logger from '#/lib/logger';

interface GeoClueLocation {
    Latitude: GLib.Variant<number>;
    Longitude: GLib.Variant<number>;
    Accuracy: GLib.Variant<number>;
}

@register({GTypeName: 'Geolocation'})
export default class Geolocation extends GObject.Object {
    static instance: Geolocation;

    static get_default() {
        if (!this.instance) this.instance = new Geolocation();
        return this.instance;
    }

    #latitude = 0;
    #longitude = 0;
    #available = false;
    #detecting = false;

    @getter(Number)
    get latitude() {
        return this.#latitude;
    }

    @getter(Number)
    get longitude() {
        return this.#longitude;
    }

    @getter(Boolean)
    get available() {
        return this.#available;
    }

    @signal([GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE], GObject.TYPE_NONE)
    locationChanged(_lat: number, _lon: number) {}

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

    async #tryGeoClue(): Promise<boolean> {
        try {
            const proxy = await new Promise<Gio.DBusProxy>(
                (resolve, reject) => {
                    Gio.DBusProxy.new_for_bus(
                        Gio.BusType.SYSTEM,
                        Gio.DBusProxyFlags.NONE,
                        null,
                        'org.freedesktop.GeoClue2',
                        '/org/freedesktop/GeoClue2/Manager',
                        'org.freedesktop.GeoClue2.Manager',
                        null,
                        (_, res) => {
                            try {
                                resolve(Gio.DBusProxy.new_for_bus_finish(res));
                            } catch (e) {
                                logger.error('geo', 'Manager proxy failed:', e);
                                reject(e);
                            }
                        }
                    );
                }
            );

            const clientPath = proxy
                .call_sync('GetClient', null, Gio.DBusCallFlags.NONE, -1, null)
                ?.get_child_value(0)
                ?.get_string()?.[0];

            if (!clientPath) {
                logger.warn('geo', 'GetClient returned no path');
                return false;
            }

            let client: Gio.DBusProxy | null = null;
            try {
                client = await new Promise<Gio.DBusProxy>((resolve, reject) => {
                    Gio.DBusProxy.new_for_bus(
                        Gio.BusType.SYSTEM,
                        Gio.DBusProxyFlags.NONE,
                        null,
                        'org.freedesktop.GeoClue2',
                        clientPath,
                        'org.freedesktop.GeoClue2.Client',
                        null,
                        (_, res) => {
                            try {
                                resolve(Gio.DBusProxy.new_for_bus_finish(res));
                            } catch (e) {
                                logger.error('geo', 'Client proxy failed:', e);
                                reject(e);
                            }
                        }
                    );
                });

                const conn = client.get_connection();
                const setProp = (
                    iface: string,
                    prop: string,
                    value: GLib.Variant
                ) => {
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

                let latestLocation: string | null = null;
                let signalId = 0;
                signalId = client!.connect(
                    'g-signal',
                    (_proxy, _sender, signalName, params) => {
                        if (signalName === 'LocationUpdated') {
                            const newPath = params
                                .get_child_value(1)
                                .get_string()?.[0];
                            logger.debug(
                                'geo',
                                `LocationUpdated signal: ${newPath}`
                            );
                            if (newPath && newPath !== '/')
                                latestLocation = newPath;
                        }
                    }
                );

                await new Promise<void>((resolve, reject) => {
                    client!.call(
                        'Start',
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_, res) => {
                            try {
                                client!.call_finish(res);
                                logger.debug('geo', 'Start succeeded');
                                resolve();
                            } catch (e) {
                                logger.error('geo', 'Start failed:', e);
                                reject(e);
                            }
                        }
                    );
                });

                let locationPath: string | null = null;
                for (let i = 0; i < 60; i++) {
                    if (latestLocation && latestLocation !== '/') {
                        locationPath = latestLocation;
                        break;
                    }
                    const cached =
                        client
                            .get_cached_property('Location')
                            ?.get_string()?.[0] ?? null;
                    if (cached && cached !== '/') {
                        locationPath = cached;
                        break;
                    }
                    await new Promise<void>(r =>
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            r();
                            return GLib.SOURCE_REMOVE;
                        })
                    );
                }

                if (signalId) client!.disconnect(signalId);

                if (!locationPath) {
                    logger.warn('geo', 'No location path after retries');
                    return false;
                }

                logger.debug(
                    'geo',
                    `Creating Location proxy for ${locationPath}`
                );
                const location = await new Promise<Gio.DBusProxy>(
                    (resolve, reject) => {
                        Gio.DBusProxy.new_for_bus(
                            Gio.BusType.SYSTEM,
                            Gio.DBusProxyFlags.NONE,
                            null,
                            'org.freedesktop.GeoClue2',
                            locationPath!,
                            'org.freedesktop.GeoClue2.Location',
                            null,
                            (_, res) => {
                                try {
                                    resolve(
                                        Gio.DBusProxy.new_for_bus_finish(res)
                                    );
                                } catch (e) {
                                    logger.error(
                                        'geo',
                                        'Location proxy failed:',
                                        e
                                    );
                                    reject(e);
                                }
                            }
                        );
                    }
                );

                const lat =
                    location.get_cached_property('Latitude')?.get_double() ?? 0;
                const lon =
                    location.get_cached_property('Longitude')?.get_double() ??
                    0;
                logger.info('geo', `coordinates lat=${lat} lon=${lon}`);

                this.#update(lat, lon);
                return true;
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
                    } catch (e) {
                        /* ignore */
                    }
                }
            }
        } catch (e) {
            logger.error('geo', 'GeoClue detection failed:', e);
            return false;
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
