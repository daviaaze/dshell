/**
 * Monitor Configuration Service — wraps Hyprland monitor API.
 *
 * Reads current monitor state from AstalHyprland and applies changes
 * via `hyprctl keyword monitor` and `hyprctl dispatch dpms`.
 */

import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {defineService} from '@shade/core/define';
import {Object, property, register} from 'gnim/gobject';
import {type AstalHyprland, getHyprland} from '../hyprland';

const LOG_TAG = 'monitorConfig';

/** Parsed monitor mode (resolution + refresh rate). */
export interface MonitorMode {
    width: number;
    height: number;
    refreshRate: number;
}

/** Extended monitor info combining Hyprland data with available modes. */
export interface MonitorInfo {
    name: string;
    description: string;
    width: number;
    height: number;
    refreshRate: number;
    scale: number;
    transform: number;
    x: number;
    y: number;
    focused: boolean;
    dpmsStatus: boolean;
    availableModes: MonitorMode[];
}

/** Parse `hyprctl monitors -j` output to extract available modes per monitor. */
async function fetchMonitorModes(): Promise<Map<string, MonitorMode[]>> {
    const map = new Map<string, MonitorMode[]>();
    try {
        const out = await Process.execAsync('hyprctl monitors -j');
        const raw: Array<{
            name: string;
            availableModes?: Array<{width: number; height: number; refreshRate: number}>;
        }> = JSON.parse(out);
        for (const m of raw) {
            if (m.availableModes) {
                map.set(
                    m.name,
                    m.availableModes.map((mode) => ({
                        width: mode.width,
                        height: mode.height,
                        refreshRate: Math.round(mode.refreshRate),
                    }))
                );
            }
        }
    } catch (e) {
        logger.error(LOG_TAG, 'Failed to fetch monitor modes:', e);
    }
    return map;
}

@register
export default class MonitorConfig extends Object {
    private static instance: MonitorConfig;

    static get_default(): MonitorConfig {
        if (!MonitorConfig.instance) MonitorConfig.instance = new MonitorConfig();
        return MonitorConfig.instance;
    }

    #hypr = getHyprland();
    #modesMap: Map<string, MonitorMode[]> = new Map();
    #notifyHandlerId = 0;

    @property
    get monitors(): MonitorInfo[] {
        if (!this.#hypr) return [];
        return this.#hypr.monitors.map((m: AstalHyprland.Monitor) => ({
            name: m.name,
            description: m.description ?? m.name,
            width: m.width,
            height: m.height,
            refreshRate: Math.round(m.refreshRate),
            scale: m.scale,
            transform: m.transform,
            x: m.x,
            y: m.y,
            focused: m.focused,
            dpmsStatus: m.dpmsStatus,
            availableModes: this.#modesMap.get(m.name) ?? [],
        }));
    }

    @property
    get available() {
        return this.#hypr !== null;
    }

    constructor() {
        super();
        this.#init();
    }

    async #init() {
        if (!this.#hypr) {
            logger.warn(LOG_TAG, 'Hyprland unavailable');
            return;
        }

        // Fetch available modes from hyprctl
        this.#modesMap = await fetchMonitorModes();
        this.notify('monitors');

        // Re-emit monitors when Hyprland's monitor list changes
        this.#notifyHandlerId = this.#hypr.connect('notify::monitors', async () => {
            // Re-fetch modes in case a new monitor was connected
            this.#modesMap = await fetchMonitorModes();
            this.notify('monitors');
        });
    }

    /** Build the hyprctl monitor keyword argument string. */
    #monitorString(
        name: string,
        width: number,
        height: number,
        rate: number,
        x: number,
        y: number,
        scale: number,
        transform: number
    ): string {
        return `"${name},${width}x${height}@${rate},${x},${y},${scale},transform,${transform}"`;
    }

    /** Look up a monitor by name. Returns null if not found. */
    #findMonitor(name: string): AstalHyprland.Monitor | null {
        return this.#hypr?.monitors.find((m: AstalHyprland.Monitor) => m.name === name) ?? null;
    }

    setResolution(name: string, w: number, h: number, rate?: number) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        const r = rate ?? Math.round(mon.refreshRate);
        const arg = this.#monitorString(
            name,
            w,
            h,
            r,
            mon.x,
            mon.y,
            mon.scale,
            mon.transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`).catch((e) =>
            logger.error(LOG_TAG, `setResolution failed for ${name}:`, e)
        );
    }

    setRefreshRate(name: string, rate: number) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        const arg = this.#monitorString(
            name,
            mon.width,
            mon.height,
            rate,
            mon.x,
            mon.y,
            mon.scale,
            mon.transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`).catch((e) =>
            logger.error(LOG_TAG, `setRefreshRate failed for ${name}:`, e)
        );
    }

    setScale(name: string, scale: number) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        const arg = this.#monitorString(
            name,
            mon.width,
            mon.height,
            Math.round(mon.refreshRate),
            mon.x,
            mon.y,
            scale,
            mon.transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`).catch((e) =>
            logger.error(LOG_TAG, `setScale failed for ${name}:`, e)
        );
    }

    setTransform(name: string, transform: number) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        const arg = this.#monitorString(
            name,
            mon.width,
            mon.height,
            Math.round(mon.refreshRate),
            mon.x,
            mon.y,
            mon.scale,
            transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`).catch((e) =>
            logger.error(LOG_TAG, `setTransform failed for ${name}:`, e)
        );
    }

    setPosition(name: string, x: number, y: number) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        const arg = this.#monitorString(
            name,
            mon.width,
            mon.height,
            Math.round(mon.refreshRate),
            x,
            y,
            mon.scale,
            mon.transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`).catch((e) =>
            logger.error(LOG_TAG, `setPosition failed for ${name}:`, e)
        );
    }

    /** Set the primary monitor (moves it to 0,0 and focuses it). */
    setPrimaryMonitor(name: string) {
        const mon = this.#findMonitor(name);
        if (!mon) return;
        // Move to 0,0 and focus
        const arg = this.#monitorString(
            name,
            mon.width,
            mon.height,
            Math.round(mon.refreshRate),
            0,
            0,
            mon.scale,
            mon.transform
        );
        Process.execAsync(`hyprctl keyword monitor ${arg}`)
            .then(() => Process.execAsync(`hyprctl dispatch focusmonitor ${name}`))
            .catch((e) => logger.error(LOG_TAG, `setPrimaryMonitor failed for ${name}:`, e));
    }

    /** Toggle DPMS (display power) for a specific monitor. */
    setDpms(name: string, on: boolean) {
        const state = on ? 'on' : 'off';
        Process.execAsync(`hyprctl dispatch dpms ${state} ${name}`).catch((e) =>
            logger.error(LOG_TAG, `setDpms failed for ${name}:`, e)
        );
    }

    /** Get available refresh rates for a given resolution on a monitor. */
    getRefreshRatesForResolution(
        monitorName: string,
        width: number,
        height: number
    ): number[] {
        const modes = this.#modesMap.get(monitorName) ?? [];
        const rates = modes
            .filter((m) => m.width === width && m.height === height)
            .map((m) => m.refreshRate);
        return [...new Set(rates)].sort((a, b) => b - a);
    }

    dispose() {
        if (this.#hypr && this.#notifyHandlerId) {
            try {
                this.#hypr.disconnect(this.#notifyHandlerId);
            } catch {
                // already disconnected
            }
            this.#notifyHandlerId = 0;
        }
    }
}

defineService({
    name: 'MonitorConfig',
    service: MonitorConfig.get_default(),
});
