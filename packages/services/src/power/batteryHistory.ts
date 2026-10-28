import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger from '@shade/core/logger';
import {type Accessor, createState} from 'gnim';

const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const UPOWER_IFACE = 'org.freedesktop.UPower';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';
/** UPower DeviceType enum value for batteries. */
const DEVICE_TYPE_BATTERY = 2;

/** Window shown in the graph. */
export const BATTERY_HISTORY_SPAN_S = 4 * 3600;
/** Number of evenly spaced slots the window is resampled into. */
export const BATTERY_HISTORY_SLOTS = 48;
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Resample UPower `(time, value, state)` entries into evenly spaced slots
 * ending at `now`. Each slot takes the latest sample at or before its end;
 * slots before the first sample are dropped so the line starts where data
 * begins. Values are fractions (0..1).
 */
export function resampleHistory(
    entries: Array<[number, number, number]>,
    now: number,
    span = BATTERY_HISTORY_SPAN_S,
    slots = BATTERY_HISTORY_SLOTS
): number[] {
    const sorted = entries.filter(([t]) => t > 0).sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    let idx = 0;
    let last: number | null = null;
    for (let slot = 0; slot < slots; slot++) {
        const slotEnd = now - span + ((slot + 1) * span) / slots;
        while (idx < sorted.length && sorted[idx][0] <= slotEnd) {
            last = sorted[idx][1] / 100;
            idx++;
        }
        if (last !== null) out.push(last);
    }
    return out;
}

/**
 * Charge-level history of the system battery, read from UPower's own
 * history (`Device.GetHistory`), so the graph already covers the time
 * before the shell started. Refreshes only while subscribed.
 */
export default class BatteryHistory {
    private static instance: BatteryHistory;

    static get_default(): BatteryHistory {
        if (!BatteryHistory.instance) BatteryHistory.instance = new BatteryHistory();
        return BatteryHistory.instance;
    }

    #history: Accessor<number[]>;
    #setHistory: (v: number[]) => void;
    #devicePath: string | null = null;
    #unavailable = false;
    #subscribers = 0;
    #timer: number | null = null;

    constructor() {
        [this.#history, this.#setHistory] = createState<number[]>([]);
    }

    /** Charge fractions over the last {@link BATTERY_HISTORY_SPAN_S}, oldest first. */
    get history(): Accessor<number[]> {
        return this.#history;
    }

    subscribe(): () => void {
        this.#subscribers++;
        if (this.#subscribers === 1) {
            void this.refresh();
            this.#timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_MS, () => {
                void this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }
        return () => {
            this.#subscribers--;
            if (this.#subscribers === 0 && this.#timer !== null) {
                GLib.source_remove(this.#timer);
                this.#timer = null;
            }
        };
    }

    async refresh(): Promise<void> {
        if (this.#unavailable) return;
        try {
            this.#devicePath ??= await this.#findBattery();
            if (!this.#devicePath) {
                this.#unavailable = true;
                return;
            }
            const reply = await this.#call(
                this.#devicePath,
                DEVICE_IFACE,
                'GetHistory',
                new GLib.Variant('(suu)', [
                    'charge',
                    BATTERY_HISTORY_SPAN_S,
                    BATTERY_HISTORY_SLOTS * 4,
                ]),
                '(a(udu))'
            );
            const [entries] = reply.deepUnpack<[Array<[number, number, number]>]>();
            this.#setHistory(resampleHistory(entries, Math.floor(Date.now() / 1000)));
        } catch (e) {
            logger.warn('batteryHistory', 'UPower history unavailable:', e);
            this.#unavailable = true;
        }
    }

    async #findBattery(): Promise<string | null> {
        const reply = await this.#call(UPOWER_PATH, UPOWER_IFACE, 'EnumerateDevices', null, '(ao)');
        const [paths] = reply.deepUnpack<[string[]]>();
        for (const path of paths) {
            const props = await this.#call(
                path,
                'org.freedesktop.DBus.Properties',
                'GetAll',
                new GLib.Variant('(s)', [DEVICE_IFACE]),
                '(a{sv})'
            );
            const [dict] = props.recursiveUnpack<[Record<string, unknown>]>();
            if (dict.Type === DEVICE_TYPE_BATTERY && dict.PowerSupply === true) return path;
        }
        return null;
    }

    #call(
        path: string,
        iface: string,
        method: string,
        params: GLib.Variant | null,
        replyType: string
    ): Promise<GLib.Variant> {
        const {promise, resolve, reject} = Promise.withResolvers<GLib.Variant>();
        const bus = Gio.DBus.system;
        bus.call(
            UPOWER_BUS,
            path,
            iface,
            method,
            params,
            new GLib.VariantType(replyType),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, res) => {
                try {
                    resolve(bus.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            }
        );
        return promise;
    }
}
