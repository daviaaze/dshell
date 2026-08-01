import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {bus} from '../bus';
import logger from '@shade/core/logger';

const BUS_NAME = 'net.hadess.PowerProfiles';
const OBJECT_PATH = '/net/hadess/PowerProfiles';
const IFACE = 'net.hadess.PowerProfiles';

const LOG_TAG = 'power-profiles';
const PROFILE_POWER_SAVER = 'power-saver';

type Profile = 'power-saver' | 'balanced' | 'performance';

export default class PowerProfiles {
    private static instance: PowerProfiles;
    static get_default() {
        if (!this.instance) {
            this.instance = new PowerProfiles();
            this.instance.#initBus();
        }
        return this.instance;
    }

    #proxy: Gio.DBusProxy | null = null;
    #busSubscriptions: (() => void)[] = [];
    #listeners = new Map<number, () => void>();
    #nextId = 0;

    get activeProfile(): Profile {
        if (!this.#proxy) return 'balanced';
        const v = this.#proxy.get_cached_property('ActiveProfile');
        return (v?.unpack() ?? 'balanced') as Profile;
    }

    get iconName(): string {
        return `power-profile-${this.activeProfile}-symbolic`;
    }

    set_active_profile(profile: Profile) {
        try {
            const conn = this.#proxy?.get_connection();
            if (!conn) {
                logger.warn(LOG_TAG, 'no DBus connection');
                return;
            }
            conn.call_sync(
                BUS_NAME,
                OBJECT_PATH,
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [
                    IFACE,
                    'ActiveProfile',
                    new GLib.Variant('s', profile),
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
        } catch (e) {
            if (e instanceof Error)
                logger.warn(
                    LOG_TAG,
                    'set_active_profile failed:',
                    e.message
                );
        }
    }

    #initBus() {
        if (this.#busSubscriptions.length > 0) return;
        this.#busSubscriptions.push(
            bus.on('power:profile:set', profile => this.set_active_profile(profile as Profile))
        );
    }

    connect(_signal: string, callback: () => void) {
        const id = this.#nextId++;
        this.#listeners.set(id, callback);
        // Initialize proxy on first connect
        if (!this.#proxy) this.#initProxy();
        return id;
    }

    disconnect(id: number) {
        this.#listeners.delete(id);
    }

    dispose() {
        this.#listeners.clear();
        this.#nextId = 0;
        this.#proxy = null;
    }

    #initProxy() {
        try {
            const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            this.#proxy = Gio.DBusProxy.new_sync(
                bus,
                Gio.DBusProxyFlags.NONE,
                null,
                BUS_NAME,
                OBJECT_PATH,
                IFACE,
                null
            );
            this.#proxy.connect(
                'g-properties-changed',
                (
                    _proxy: Gio.DBusProxy,
                    changed: GLib.Variant,
                    _invalidated: string[]
                ) => {
                    if (changed.lookup_value('ActiveProfile', null) !== null) {
                        for (const cb of this.#listeners.values()) cb();
                    }
                }
            );
        } catch (e) {
            if (e instanceof Error)
                logger.warn(
                    LOG_TAG,
                    'failed to connect to system bus:',
                    e.message
                );
        }
    }
}

export function profileLabel(p: string): string {
    switch (p) {
        case PROFILE_POWER_SAVER:
            return 'Power Saver';
        case 'balanced':
            return 'Balanced';
        case 'performance':
            return 'Performance';
        default:
            return 'Balanced';
    }
}

export function nextProfile(p: string): Profile {
    switch (p) {
        case PROFILE_POWER_SAVER:
            return 'balanced';
        case 'balanced':
            return 'performance';
        default:
            return PROFILE_POWER_SAVER;
    }
}
