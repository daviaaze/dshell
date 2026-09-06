/**
 * Display Layout — monitor layouts and per-monitor enable/disable.
 *
 * Thin wrapper around the `shade-layout` CLI (NixOS system package, see
 * nix/hyprland/layouts.nix) plus `hyprctl` for ad-hoc monitor toggles.
 * Widgets in quicksettings render `layouts`, `currentLayout` and
 * `monitors`, and command changes back through the bus events declared in
 * ./contract.ts.
 *
 * `currentLayout` is defined as the layout whose monitor set (matched by
 * name or EDID description) equals the connected monitors — the same
 * predicate `shade-layout cycle` uses — so the highlight always reflects
 * reality after hotplugs and applies.
 */
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register} from 'gnim/gobject';
import {bus} from '../bus';
import {getHyprland} from '../hyprland';

export interface MonitorEntry {
    name: string;
    description: string;
    enabled: boolean;
}

/** Parse `shade-layout list` stdout into a deduped, order-preserving name list. */
export function parseLayoutList(stdout: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of stdout.split('\n')) {
        const name = line.trim();
        if (name && !seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out;
}

/** Parse `shade-layout monitors <name>` stdout (name<TAB>description lines). */
export function parseMonitorList(stdout: string): {name: string; description: string}[] {
    const out: {name: string; description: string}[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const [name, desc = ''] = line.split('\t');
        out.push({name: name.trim(), description: desc.trim()});
    }
    return out;
}

@register
export default class DisplayLayout extends Object {
    private static instance: DisplayLayout;
    static get_default() {
        if (!DisplayLayout.instance) DisplayLayout.instance = new DisplayLayout();
        return DisplayLayout.instance;
    }

    #initialized = false;
    #refreshTimer = 0;
    #busSubscriptions: (() => void)[] = [];
    #monitorSignals: number[] = [];

    #layouts: string[] = [];
    #currentLayout: string | null = null;
    #configuredMonitors: {name: string; description: string}[] = [];
    #liveMonitors: {name: string; description: string}[] = [];

    @property
    get layouts(): string[] {
        return this.#layouts;
    }

    @property
    get currentLayout(): string | null {
        return this.#currentLayout;
    }

    /**
     * Monitor toggles to show: the union of live monitors and the active
     * layout's configured entries, so a monitor disabled by a layout (and
     * therefore absent from the live list) can be re-enabled from the GUI.
     */
    @property
    get monitors(): MonitorEntry[] {
        const live = new Set(this.#liveMonitors.map((m) => m.description || m.name));
        const map = new Map<string, MonitorEntry>();
        for (const m of [...this.#configuredMonitors, ...this.#liveMonitors]) {
            const key = m.description || m.name;
            if (!map.has(key)) map.set(key, {name: m.name, description: m.description, enabled: live.has(key)});
        }
        return [...map.values()];
    }

    init() {
        if (this.#initialized) {
            logger.warn('displayLayout', 'init() called but already initialized — skipping');
            return;
        }
        this.#initialized = true;

        const hypr = getHyprland();
        if (!hypr) {
            logger.warn('displayLayout', 'hyprland unavailable — layout controls disabled');
            return;
        }

        this.#monitorSignals.push(
            hypr.connect('monitor-added', () => this.#scheduleRefresh()),
            hypr.connect('monitor-removed', () => this.#scheduleRefresh())
        );

        this.#busSubscriptions.push(
            bus.on('display:layout:apply', (name) => {
                void this.#apply(name);
            }),
            bus.on('display:monitor:set-enabled', (args) => {
                void this.#setEnabled(args);
            })
        );

        void this.#refresh();
    }

    async #apply(name: string) {
        try {
            await Process.execAsyncv(['shade-layout', 'apply', name], true);
        } catch (e) {
            logger.error('displayLayout', `apply '${name}' failed:`, e);
        }
        this.#scheduleRefresh();
    }

    async #setEnabled({description, enabled}: {description: string; enabled: boolean}) {
        try {
            if (enabled) {
                // Loose re-add; shade-layout-auto (or the delayed auto
                // below) restores the full geometry from the layout.
                await Process.execAsyncv(
                    ['hyprctl', 'keyword', `monitor desc:${description},preferred,auto,1`],
                    true
                );
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    void this.#execAuto();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                await Process.execAsyncv(
                    ['hyprctl', 'keyword', `monitor desc:${description},disable`],
                    true
                );
            }
        } catch (e) {
            logger.error('displayLayout', 'set-enabled failed:', e);
        }
        this.#scheduleRefresh();
    }

    async #execAuto() {
        try {
            await Process.execAsyncv(['shade-layout', 'auto'], true);
        } catch (e) {
            logger.error('displayLayout', 'auto re-apply failed:', e);
        }
        this.#scheduleRefresh();
    }

    #scheduleRefresh() {
        if (this.#refreshTimer) GLib.source_remove(this.#refreshTimer);
        this.#refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this.#refreshTimer = 0;
            void this.#refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async #refresh() {
        try {
            const currentOut = (await Process.execAsyncv(['shade-layout', 'current'], true)).trim();
            const [listOut, monOut] = await Promise.all([
                Process.execAsyncv(['shade-layout', 'list'], true),
                this.#currentLayout || currentOut
                    ? Process.execAsyncv(
                          ['shade-layout', 'monitors', currentOut || (this.#currentLayout as string)],
                          true
                      )
                    : Promise.resolve(''),
            ]);

            this.#currentLayout = currentOut || null;
            this.#layouts = parseLayoutList(listOut);
            this.#configuredMonitors = parseMonitorList(monOut);

            const hypr = getHyprland();
            this.#liveMonitors = (hypr?.monitors ?? []).map((m) => ({
                name: m.name ?? '',
                description: m.description ?? '',
            }));

            this.notify('layouts');
            this.notify('current-layout');
            this.notify('monitors');
        } catch (e) {
            logger.error('displayLayout', 'refresh failed:', e);
        }
    }
}

defineService({
    name: 'DisplayLayout',
    service: DisplayLayout.get_default(),
});
