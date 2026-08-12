import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {generalSettings} from '@shade/core/settings/general.gschema';
import type {Accessor} from 'gnim';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';

export const TEMP_MIN = 2000;
export const TEMP_MAX = 6500;

@register
export default class NightLight extends Object {
    private static instance: NightLight;
    static get_default() {
        if (!NightLight.instance) NightLight.instance = new NightLight();
        return NightLight.instance;
    }

    constructor() {
        super();

        this.#generalSettings = new Gio.Settings({
            schemaId: `${import.meta.domain}.general`,
        });
    }

    #enabled = false;
    #temperature = 3500;
    #autoSchedule = false;
    #process: Process | null = null;
    #transitionTimer: number | null = null;
    #initialized = false;
    #generalHandlerId = 0;
    #busSubscriptions: (() => void)[] = [];
    #generalSettings: Gio.Settings;
    #settings: {
        nightLightEnabled: Accessor<boolean>;
        nightLightTemperature: Accessor<number>;
        nightLightAutoSchedule: Accessor<boolean>;
        setNightLightEnabled: (v: boolean) => void;
        setNightLightTemperature: (v: number) => void;
        setNightLightAutoSchedule: (v: boolean) => void;
    } | null = null;

    @property
    get enabled() {
        return this.#enabled;
    }

    set enabled(v: boolean) {
        if (this.#enabled === v) return;
        this.#enabled = v;
        this.#settings?.setNightLightEnabled(v);
        this.#sync();
        this.notify('enabled');
    }

    @property
    get temperature() {
        return this.#temperature;
    }

    set temperature(v: number) {
        v = Math.max(TEMP_MIN, Math.min(TEMP_MAX, v));
        if (this.#temperature === v) return;
        this.#temperature = v;
        this.#settings?.setNightLightTemperature(v);
        if (this.#enabled) this.#sync();
        this.notify('temperature');
    }

    @property
    get autoSchedule() {
        return this.#autoSchedule;
    }

    set autoSchedule(v: boolean) {
        if (this.#autoSchedule === v) return;
        this.#autoSchedule = v;
        this.#settings?.setNightLightAutoSchedule(v);
        this.#scheduleNextTransition();
        this.notify('auto-schedule');
    }

    @property
    get available() {
        return GLib.find_program_in_path('hyprsunset') !== null;
    }

    init(settings: {
        nightLightEnabled: Accessor<boolean>;
        nightLightTemperature: Accessor<number>;
        nightLightAutoSchedule: Accessor<boolean>;
        setNightLightEnabled: (v: boolean) => void;
        setNightLightTemperature: (v: number) => void;
        setNightLightAutoSchedule: (v: boolean) => void;
    }) {
        if (this.#initialized) {
            logger.warn('nightLight', 'init() called but already initialized — skipping');
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

        // Listen for daytime changes from GSettings — re-arm the one-shot
        // timer since sunrise/sunset timestamps were updated by Weather.
        this.#generalHandlerId = this.#generalSettings.connect(
            'changed::weather-is-daytime',
            () => {
                this.#checkSchedule();
                this.#scheduleNextTransition();
            }
        );

        this.#sync();
        this.#scheduleNextTransition();

        // Listen for commands from widgets via the bus
        this.#busSubscriptions.push(
            bus.on('display:nightlight:enabled', (v) => {
                this.enabled = v;
            })
        );
        this.#busSubscriptions.push(
            bus.on('display:nightlight:temperature', (v) => {
                this.temperature = v;
            })
        );
        this.#busSubscriptions.push(
            bus.on('display:nightlight:schedule', (v) => {
                this.autoSchedule = v;
            })
        );
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

    /**
     * Schedule a one-shot timer for the next sunrise/sunset transition.
     * The daytime flag only changes twice a day, so polling is wasteful —
     * compute when the next transition fires and sleep until then.
     */
    #scheduleNextTransition(): void {
        if (this.#transitionTimer !== null) {
            GLib.source_remove(this.#transitionTimer);
            this.#transitionTimer = null;
        }
        if (!this.#autoSchedule) return;

        const now = Date.now();
        const sunrise = this.#generalSettings.get_double('weather-sunrise-time') * 1000;
        const sunset = this.#generalSettings.get_double('weather-sunset-time') * 1000;
        const isDaytime = this.#generalSettings.get_boolean('weather-is-daytime');

        // Next transition: if currently daytime, next is sunset; otherwise sunrise.
        const nextTransition = isDaytime ? sunset : sunrise;
        // Guard against invalid/zero timestamps (weather not loaded yet)
        let delayMs = nextTransition > now ? nextTransition - now : 0;
        if (delayMs <= 0 || delayMs > 12 * 3600 * 1000) {
            // No valid transition scheduled — fall back to checking in 1 hour
            delayMs = 3600 * 1000;
        }

        this.#transitionTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this.#transitionTimer = null;
            this.#checkSchedule();
            this.#scheduleNextTransition(); // re-arm for the next one
            return GLib.SOURCE_REMOVE;
        });
    }

    dispose() {
        if (this.#generalHandlerId !== 0) {
            try {
                this.#generalSettings.disconnect(this.#generalHandlerId);
            } catch {
                /* ignore */
            }
            this.#generalHandlerId = 0;
        }
        if (this.#transitionTimer !== null) {
            GLib.source_remove(this.#transitionTimer);
            this.#transitionTimer = null;
        }
        this.#stopProcess();
    }
}

defineService({
    name: 'NightLight',
    service: NightLight.get_default(),
    initArgs: () => [generalSettings()],
});
