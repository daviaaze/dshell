/**
 * LayoutService — runtime monitor + layout management.
 *
 * Owns the user's named monitor layouts and applies them live through
 * `hyprctl keyword`. Complements the Nix-declared `shade-layout` system:
 * that one manages build-time layouts, this one manages layouts the user
 * edits from Shade Settings at runtime, persisted to
 * $XDG_CONFIG_HOME/shade/monitor-layouts.json.
 *
 * A layout captures the physical setup of every monitor (mode, position,
 * scale, rotation, VRR) plus the workspace → monitor bindings, so applying
 * a layout restores both where monitors sit and where windows land.
 *
 * Auto-apply follows the pattern of monique's hotplug daemon: when monitors
 * connect or disconnect, the best matching saved layout is reapplied
 * (debounced, gated by the `monitors.auto-apply` setting).
 */

import GLib from 'gi://GLib?version=2.0';
import {readFile, writeFile} from '@shade/core/file';
import {toArray} from '@shade/core/gjsUtils';
import logger from '@shade/core/logger';
import {execAsync} from '@shade/core/process';
import {Object as GObject, property, register, signal} from 'gnim/gobject';
import {notify} from '../capture/utils';
import {type AstalHyprland, getHyprland} from '../hyprland';
import {monitorsSettings} from '../settings/monitors.gschema';

/** One monitor's physical configuration inside a layout. */
export interface MonitorSpec {
    /** Connector name, e.g. "DP-1". */
    name: string;
    /** Mode like "2560x1440@144" or "preferred". */
    resolution: string;
    /** Hyprland position string, e.g. "0x0" or "-1080x-240". */
    position: string;
    scale: number;
    /** 0=normal 1=90° 2=180° 3=270°. */
    transform: number;
    /** VRR state (0=off, 1=on). */
    vrr: number | null;
    disabled: boolean;
}

/** A named monitor setup: physical arrangement + workspace bindings. */
export interface Layout {
    monitors: MonitorSpec[];
    /** workspace id → monitor name, applied as Hyprland workspace rules. */
    workspaces: Record<number, string>;
}

interface LayoutStore {
    version: 1;
    current: string | null;
    layouts: Record<string, Layout>;
}

const EMPTY_STORE: LayoutStore = {version: 1, current: null, layouts: {}};

/** Resolve the layouts store path (overridable for tests). */
function defaultStorePath(): string {
    const override = GLib.getenv('SHADE_LAYOUTS_FILE');
    if (override) return override;
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'shade', 'monitor-layouts.json']);
}

/** Render a MonitorSpec into the `hyprctl keyword` monitor line. */
export function renderMonitorSpec(spec: MonitorSpec): string {
    if (spec.disabled) return `monitor ${spec.name},disable`;
    const parts = [`monitor ${spec.name}`, spec.resolution, spec.position, `${spec.scale}`];
    if (spec.transform !== 0) parts.push('transform', `${spec.transform}`);
    if (spec.vrr != null && spec.vrr !== 0) parts.push('vrr', `${spec.vrr}`);
    return parts.join(',');
}

@register
export class LayoutService extends GObject {
    private static instance: LayoutService | null = null;

    static get_default(): LayoutService {
        if (!LayoutService.instance) LayoutService.instance = new LayoutService();
        return LayoutService.instance;
    }

    /** Test hook: drop the singleton so a fresh one picks up a new env. */
    static testReset(): void {
        LayoutService.instance = null;
    }

    #store: LayoutStore;
    #loaded = false;
    readonly #storePath: string;
    /** Last successfully applied enabled spec per monitor — used to re-enable. */
    #lastEnabled: Map<string, MonitorSpec>;
    #autoApplyTimer: number | null = null;
    #monitorAddedId = 0;
    #monitorRemovedId = 0;

    constructor() {
        super();
        // Object-typed private fields MUST be initialized in the constructor
        // body: field initializers on gnim @register classes end up shared
        // across instances (mutating one corrupts every other).
        this.#store = {version: 1, current: null, layouts: {}};
        this.#lastEnabled = new Map<string, MonitorSpec>();
        this.#storePath = defaultStorePath();
        this.#connectMonitorEvents();
    }

    /**
     * Auto-apply the best matching saved layout when monitors connect or
     * disconnect (research pattern from monique's hotplug daemon).
     */
    #connectMonitorEvents(): void {
        const hl = getHyprland();
        if (!hl) return;
        const onHotplug = () => this.#scheduleAutoApply();
        this.#monitorAddedId = hl.connect('monitor-added', onHotplug);
        this.#monitorRemovedId = hl.connect('monitor-removed', onHotplug);
    }

    /** Debounce rapid hotplug events (monique uses 500ms). */
    #scheduleAutoApply(): void {
        if (this.#autoApplyTimer !== null) return;
        if (!monitorsSettings().autoApply.peek()) return;
        this.#autoApplyTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this.#autoApplyTimer = null;
            this.#autoApply();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Pick the saved layout that fits the connected monitors best and apply it. */
    #autoApply(): void {
        this.#load();
        const connected = new Set(this.monitorSpecs().map((s) => s.name));
        let best: string | null = null;
        let bestCount = -1;
        for (const [name, layout] of Object.entries(this.#store.layouts)) {
            const eligible = layout.monitors.every((m) => m.disabled || connected.has(m.name));
            if (!eligible) continue;
            const count = layout.monitors.filter((m) => !m.disabled).length;
            if (count > bestCount) {
                bestCount = count;
                best = name;
            }
        }
        if (best && best !== this.#store.current) {
            logger.info('layouts', `auto-applying layout '${best}' after monitor change`);
            this.apply(best);
        }
    }

    /** Saved layout names, sorted. */
    @property
    get names(): string[] {
        return Object.keys(this.#load().layouts).sort();
    }

    /** Name of the layout most recently applied, or null. */
    @property
    get current(): string | null {
        return this.#load().current;
    }

    /** Emitted after a layout was applied successfully. */
    @signal
    applied(_name: string): void {}

    /** Emitted after the store mutated (save/remove). */
    @signal
    storeChanged(): void {}

    #load(): LayoutStore {
        if (this.#loaded) return this.#store;
        this.#loaded = true;
        try {
            const parsed = JSON.parse(readFile(this.#storePath)) as Partial<LayoutStore>;
            if (parsed && typeof parsed === 'object' && parsed.layouts !== undefined) {
                this.#store = {...EMPTY_STORE, ...parsed};
            }
        } catch (err) {
            logger.debug('layouts', `no layout store at ${this.#storePath}:`, err);
        }
        return this.#store;
    }

    #persist(): void {
        try {
            writeFile(this.#storePath, JSON.stringify(this.#store, null, 2));
        } catch (err) {
            logger.error('layouts', `failed to write ${this.#storePath}:`, err);
        }
    }

    /** Get a saved layout by name, or null. */
    get(name: string): Layout | null {
        return this.#load().layouts[name] ?? null;
    }

    /** Persist a named layout. With no layout given, snapshots the live setup.
     *  Returns false (and refuses) when there is nothing to capture. */
    save(name: string, layout?: Layout): boolean {
        const trimmed = name.trim();
        if (!trimmed) return false;
        this.#load();
        const next = layout ?? this.captureLayout();
        if (next.monitors.length === 0) {
            logger.warn('layouts', 'refusing to save empty capture (Hyprland unavailable?)');
            return false;
        }
        this.#store.layouts[trimmed] = next;
        this.#persist();
        this.notify('names');
        this.storeChanged();
        logger.info('layouts', `saved layout '${trimmed}'`);
        return true;
    }

    /** Delete a saved layout. Clears `current` if it pointed at it. */
    remove(name: string): boolean {
        this.#load();
        if (!(name in this.#store.layouts)) return false;
        delete this.#store.layouts[name];
        if (this.#store.current === name) {
            this.#store.current = null;
            this.notify('current');
        }
        this.#persist();
        this.notify('names');
        this.storeChanged();
        logger.info('layouts', `removed layout '${name}'`);
        return true;
    }

    /** Build a MonitorSpec from the live Hyprland state of one monitor. */
    specFor(mon: AstalHyprland.Monitor): MonitorSpec {
        return {
            name: mon.name,
            resolution: mon.currentFormat || 'preferred',
            position: `${mon.x}x${mon.y}`,
            scale: mon.scale || 1,
            transform: mon.transform ?? 0,
            vrr: mon.vrr ? 1 : 0,
            disabled: !!mon.disabled,
        };
    }

    /** Live monitor specs — the current physical arrangement. */
    monitorSpecs(): MonitorSpec[] {
        const hl = getHyprland();
        if (!hl) return [];
        return toArray<AstalHyprland.Monitor>(hl.monitors)
            .filter((m) => m.name)
            .map((m) => this.specFor(m));
    }

    /** Live workspace → monitor bindings (regular workspaces only). */
    captureWorkspaces(): Record<number, string> {
        const hl = getHyprland();
        if (!hl) return {};
        const out: Record<number, string> = {};
        for (const ws of toArray<AstalHyprland.Workspace>(hl.workspaces)) {
            if (ws.id <= 0) continue; // skip special workspaces
            const mon = ws.get_monitor();
            if (mon) out[ws.id] = mon.name;
        }
        return out;
    }

    /** Snapshot of the current monitors + workspace bindings. */
    captureLayout(): Layout {
        return {monitors: this.monitorSpecs(), workspaces: this.captureWorkspaces()};
    }

    /** Apply one monitor spec live. Errors are logged and notified, never thrown. */
    applySpec(spec: MonitorSpec): void {
        execAsync(renderMonitorSpec(spec))
            .then(() => {
                if (spec.disabled) this.#lastEnabled.delete(spec.name);
                else this.#lastEnabled.set(spec.name, spec);
            })
            .catch((err) => {
                logger.error('layouts', `apply failed for ${spec.name}:`, err);
                notify('Monitor settings failed', `${spec.name}: ${err}`, 'dialog-error-symbolic');
            });
    }

    /** Toggle a monitor on/off. The last enabled monitor cannot be disabled. */
    applyEnabled(name: string, enabled: boolean): void {
        const live = this.monitorSpecs();
        const enabledCount = live.filter((s) => !s.disabled).length;
        if (!enabled && enabledCount <= 1) {
            notify('Cannot disable monitor', 'At least one monitor must stay enabled.', 'dialog-warning-symbolic');
            return;
        }
        if (enabled) {
            const cached = this.#lastEnabled.get(name);
            const spec = cached
                ? {...cached, disabled: false}
                : {name, resolution: 'preferred', position: 'auto', scale: 1, transform: 0, vrr: null, disabled: false};
            this.applySpec(spec);
            return;
        }
        const liveSpec = live.find((s) => s.name === name);
        if (liveSpec) this.#lastEnabled.set(name, {...liveSpec, disabled: false});
        this.applySpec({name, resolution: 'preferred', position: 'auto', scale: 1, transform: 0, vrr: null, disabled: true});
    }

    /** Apply a saved layout: monitor arrangement then workspace bindings. */
    async apply(name: string): Promise<boolean> {
        this.#load();
        const layout = this.#store.layouts[name];
        if (!layout) {
            logger.warn('layouts', `apply: layout '${name}' not found`);
            notify('Layout not found', `No layout named '${name}'.`, 'dialog-error-symbolic');
            return false;
        }
        for (const spec of layout.monitors) this.applySpec(spec);
        for (const [id, mon] of Object.entries(layout.workspaces)) {
            if (!mon) continue;
            execAsync(`hyprctl keyword workspace ${id},monitor:${mon},default:true`).catch((err) => {
                logger.error('layouts', `workspace ${id} → ${mon} failed:`, err);
            });
        }
        this.#store.current = name;
        this.#persist();
        this.notify('current');
        this.applied(name);
        logger.info('layouts', `applied layout '${name}'`);
        return true;
    }
}

export default LayoutService;