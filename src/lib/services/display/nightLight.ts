import GObject, {getter, register, setter} from 'gnim/gobject';
import {Process} from '#/lib/core/process';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import logger from '#/lib/core/logger';
import {Accessor} from 'gnim';

export const TEMP_MIN = 2000;
export const TEMP_MAX = 6500;

@register({GTypeName: 'NightLight'})
export default class NightLight extends GObject.Object {
    static readonly POLL_INTERVAL_SECONDS = 5;

    static instance: NightLight;
    static get_default() {
        if (!this.instance) this.instance = new NightLight();
        return this.instance;
    }

    constructor() {
        super();

        this.#generalSettings = new Gio.Settings({
            schema_id: `${import.meta.domain}.general`,
        });
    }

    #enabled = false;
    #temperature = 3500;
    #autoSchedule = false;
    #process: Process | null = null;
    #pollTimer: number | null = null;
    #initialized = false;
    #generalHandlerId = 0;
    #generalSettings: Gio.Settings;
    #settings: {
        nightLightEnabled: Accessor<boolean>;
        nightLightTemperature: Accessor<number>;
        nightLightAutoSchedule: Accessor<boolean>;
        setNightLightEnabled: (v: boolean) => void;
        setNightLightTemperature: (v: number) => void;
        setNightLightAutoSchedule: (v: boolean) => void;
    } | null = null;

    @getter(Boolean)
    get enabled() {
        return this.#enabled;
    }

    @setter(Boolean)
    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        this.#enabled = v;
        this.#settings?.setNightLightEnabled(v);
        this.#sync();
        this.notify('enabled');
    }

    @getter(Number)
    get temperature() {
        return this.#temperature;
    }

    @setter(Number)
    set temperature(v: number) {
        v = Math.max(TEMP_MIN, Math.min(TEMP_MAX, v));
        if (this.#temperature === v) return;
        this.#temperature = v;
        this.#settings?.setNightLightTemperature(v);
        if (this.#enabled) this.#sync();
        this.notify('temperature');
    }

    @getter(Boolean)
    get autoSchedule() {
        return this.#autoSchedule;
    }

    @setter(Boolean)
    set autoSchedule(v: boolean) {
        if (this.#autoSchedule === v) return;
        this.#autoSchedule = v;
        this.#settings?.setNightLightAutoSchedule(v);
        this.#checkSchedule();
        this.notify('auto-schedule');
    }

    @getter(Boolean)
    get available() {
        return GLib.find_program_in_path('hyprsunset') !== null;
    }

    init(
        settings: {
            nightLightEnabled: Accessor<boolean>;
            nightLightTemperature: Accessor<number>;
            nightLightAutoSchedule: Accessor<boolean>;
            setNightLightEnabled: (v: boolean) => void;
            setNightLightTemperature: (v: number) => void;
            setNightLightAutoSchedule: (v: boolean) => void;
        }
    ) {
        if (this.#initialized) {
            logger.warn(
                'nightLight',
                'init() called but already initialized — skipping'
            );
            return;
        }
        this.#initialized = true;
        this.#settings = settings;
        this.#enabled = settings.nightLightEnabled();
        this.#temperature = settings.nightLightTemperature();
        this.#autoSchedule = settings.nightLightAutoSchedule();

        settings.nightLightEnabled.subscribe(() => {
            const newEnabled = settings.nightLightEnabled();
            if (newEnabled !== this.#enabled) {
                this.#enabled = newEnabled;
                this.notify('enabled');
                this.#sync();
            }
        });

        settings.nightLightTemperature.subscribe(() => {
            const newTemp = settings.nightLightTemperature();
            if (newTemp !== this.#temperature) {
                this.#temperature = newTemp;
                this.notify('temperature');
                if (this.#enabled) this.#sync();
            }
        });

        settings.nightLightAutoSchedule.subscribe(() => {
            const newAuto = settings.nightLightAutoSchedule();
            if (newAuto !== this.#autoSchedule) {
                this.#autoSchedule = newAuto;
                this.notify('auto-schedule');
                this.#checkSchedule();
            }
        });

        // Listen for daytime changes from GSettings
        this.#generalHandlerId = this.#generalSettings.connect(
            'changed::weather-is-daytime',
            () => this.#checkSchedule()
        );

        this.#sync();
        this.#startPoll();
    }

    #sync() {
        if (!this.available) return;
        if (this.#enabled) {
            this.#startProcess();
        } else {
            this.#stopProcess();
        }
    }

    #startProcess() {
        this.#stopProcess();
        try {
            this.#process = Process.subprocessv([
                'hyprsunset',
                '--temperature',
                this.#temperature.toString(),
            ]);
        } catch (e) {
            logger.error('nightlight', 'failed to start hyprsunset:', e);
        }
    }

    #stopProcess() {
        if (this.#process) {
            try {
                this.#process.kill();
            } catch {
                /* ignore */
            }
            this.#process = null;
        }
    }

    #checkSchedule() {
        if (!this.#autoSchedule) return;
        const isDaytime = this.#generalSettings.get_boolean('weather-is-daytime');
        const shouldBeOn = !isDaytime;
        if (this.#enabled !== shouldBeOn) {
            this.enabled = shouldBeOn;
        }
    }

    #startPoll() {
        if (this.#pollTimer) GLib.source_remove(this.#pollTimer);
        this.#pollTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            NightLight.POLL_INTERVAL_SECONDS,
            () => {
                if (this.#autoSchedule) this.#checkSchedule();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    dispose() {
        if (this.#generalHandlerId !== 0) {
            try {
                this.#generalSettings.disconnect(this.#generalHandlerId);
            } catch { /* ignore */ }
            this.#generalHandlerId = 0;
        }
        if (this.#pollTimer) {
            GLib.source_remove(this.#pollTimer);
            this.#pollTimer = null;
        }
        this.#stopProcess();
    }
}
