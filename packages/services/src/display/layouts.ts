import type Cairo from 'gi://cairo?version=1.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import {readFile, writeFile} from '@shade/core/file';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object as GObject, property, register, signal} from 'gnim/gobject';
import {notify} from '../capture/utils';
import {getHyprland} from '../hyprland';
import {monitorsSettings} from '../settings/monitors.gschema';
import ShellState from '../state/shellState';
import {
    buildDisplayMode,
    detectDisplayMode,
    getAvailableDisplayModes,
    logicalMonitorSize,
    setLayoutOutputEnabled,
} from './modes';
import type {DisplayMode} from './modes';

export interface MonitorSpec {
    name: string;
    description?: string;
    resolution: string;
    position: string;
    scale: number;
    transform: number;
    vrr: number | null;
    disabled: boolean;
    mirror?: string | null;
}

export interface OutputInfo extends MonitorSpec {
    mirror: string | null;
    id: number;
    enabled: boolean;
    dpms: boolean;
    width: number;
    height: number;
    x: number;
    y: number;
    modes: {width: number; height: number; refreshRate: number}[];
}

export interface Layout {
    monitors: MonitorSpec[];
    workspaces: Record<number, string>;
    auto?: boolean;
}

interface LayoutStore {
    version: 1;
    current: string | null;
    layouts: Record<string, Layout>;
}

export interface DisplaySnapshot {
    attached: OutputInfo[];
    active: OutputInfo[];
    workspaces?: Record<number, string>;
}

export interface DisplayAdapter {
    snapshot(): Promise<DisplaySnapshot>;
    keyword(spec: MonitorSpec): Promise<void>;
    workspace(id: number, monitor: string): Promise<void>;
}

export interface LayoutServiceOptions {
    adapter?: DisplayAdapter;
    storePath?: string;
    schedule?: (delay: number, callback: () => void | Promise<void>) => number;
    cancel?: (id: number) => void;
    autoApply?: () => boolean;
}

type RawMonitor = {
    name?: unknown;
    id?: unknown;
    description?: unknown;
    currentFormat?: unknown;
    refreshRate?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    scale?: unknown;
    transform?: unknown;
    vrr?: unknown;
    dpmsStatus?: unknown;
    disabled?: unknown;
    mirrorOf?: unknown;
    availableModes?: unknown;
};

type RawMode = {width?: unknown; height?: unknown; refreshRate?: unknown};
type RawWorkspace = {id?: unknown; monitor?: unknown};

const EMPTY_STORE: LayoutStore = {version: 1, current: null, layouts: {}};

export function renderMonitorSpec(spec: MonitorSpec): string {
    if (spec.disabled) return `monitor ${spec.name},disable`;
    const parts = [`monitor ${spec.name}`, spec.resolution, spec.position, `${spec.scale}`];
    if (spec.transform !== 0) parts.push('transform', `${spec.transform}`);
    if (spec.vrr != null && spec.vrr !== 0) parts.push('vrr', `${spec.vrr}`);
    parts.push('mirror', spec.mirror ?? '');
    return parts.join(',');
}

function defaultStorePath(): string {
    const override = GLib.getenv('SHADE_LAYOUTS_FILE');
    return (
        override ??
        GLib.build_filenamev([GLib.get_user_config_dir(), 'shade', 'monitor-layouts.json'])
    );
}

function defaultSchedule(delay: number, callback: () => void | Promise<void>): number {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        const result = callback();
        if (result instanceof Promise)
            void result.catch((error: unknown) => logger.error('layouts', String(error)));
        return GLib.SOURCE_REMOVE;
    });
}

function missingFile(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

function normalizedMirror(mirror: string | null | undefined): string | null {
    return mirror || null;
}

function normalizeLayout(layout: Layout): Layout {
    return {
        ...layout,
        monitors: layout.monitors.map((monitor) => ({
            ...monitor,
            mirror: normalizedMirror(monitor.mirror),
        })),
    };
}

function parseStore(value: unknown): LayoutStore {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('Invalid layout store');
    const parsed = value as Partial<LayoutStore>;
    if (
        parsed.version !== 1 ||
        typeof parsed.layouts !== 'object' ||
        !parsed.layouts ||
        Array.isArray(parsed.layouts)
    )
        throw new Error('Invalid layout store');
    const layouts: Record<string, Layout> = {};
    for (const [name, layout] of Object.entries(parsed.layouts))
        layouts[name] = normalizeLayout(layout);
    return {...EMPTY_STORE, ...parsed, layouts};
}

function parseMonitorArray(value: unknown): RawMonitor[] {
    if (!Array.isArray(value)) throw new Error('Invalid Hyprland monitor snapshot');
    return value.map((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item))
            throw new Error('Invalid monitor record');
        return item as RawMonitor;
    });
}

function parseWorkspaceArray(value: unknown): Record<number, string> {
    if (!Array.isArray(value)) throw new Error('Invalid Hyprland workspace snapshot');
    const workspaces: Record<number, string> = {};
    for (const entry of value) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const workspace = entry as RawWorkspace;
        const id = Number(workspace.id);
        if (Number.isInteger(id) && typeof workspace.monitor === 'string')
            workspaces[id] = workspace.monitor;
    }
    return workspaces;
}
function mirrorSource(raw: RawMonitor, namesById: Map<string, string>): string | null {
    const rawMirror = raw.mirrorOf;
    if (rawMirror === undefined || rawMirror === null || rawMirror === '' || rawMirror === 'none')
        return null;
    const source = namesById.get(String(rawMirror));
    if (!source) throw new Error(`Mirror source is not attached: ${String(rawMirror)}`);
    return source;
}

function monitorFromRaw(raw: RawMonitor, enabled: boolean, mirror: string | null): OutputInfo {
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name) throw new Error('Hyprland returned a monitor without a connector name');
    const description =
        typeof raw.description === 'string' && raw.description ? raw.description : undefined;
    const x = Number(raw.x ?? 0);
    const y = Number(raw.y ?? 0);
    const width = Number(raw.width ?? 0);
    const height = Number(raw.height ?? 0);
    const scale = Number(raw.scale ?? 1);
    const rawId = Number(raw.id);
    const modes = Array.isArray(raw.availableModes)
        ? raw.availableModes.flatMap((value) => {
              if (typeof value === 'string') {
                  const match = /^(\d+)x(\d+)@([\d.]+)Hz$/.exec(value);
                  if (!match) return [];
                  return [
                      {
                          width: Number(match[1]),
                          height: Number(match[2]),
                          refreshRate: Number(match[3]),
                      },
                  ];
              }
              if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
              const mode = value as RawMode;
              return [
                  {
                      width: Number(mode.width),
                      height: Number(mode.height),
                      refreshRate: Number(mode.refreshRate),
                  },
              ];
          })
        : [];
    const refreshRate = Number(raw.refreshRate);
    const resolution =
        width > 0 && height > 0 && Number.isFinite(refreshRate) && refreshRate > 0
            ? `${width}x${height}@${refreshRate.toFixed(2)}`
            : 'preferred';
    return {
        id: Number.isFinite(rawId) ? rawId : -1,
        name,
        description,
        resolution,
        position: `${x}x${y}`,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        transform: Number(raw.transform ?? 0),
        vrr: raw.vrr ? 1 : 0,
        mirror,
        disabled: !enabled,
        enabled,
        dpms: raw.dpmsStatus !== false,
        width,
        height,
        x,
        y,
        modes,
    };
}

export function parseHyprlandSnapshot(
    allValue: unknown,
    activeValue: unknown,
    workspaceValue?: unknown
): DisplaySnapshot {
    // Hyprland's synthetic fallback is not a usable display or part of a saved topology.
    const all = parseMonitorArray(allValue).filter((monitor) => monitor.name !== 'FALLBACK');
    const active = parseMonitorArray(activeValue);
    const activeNames: Record<string, true> = {};
    const namesById = new Map<string, string>();
    for (const monitor of active)
        if (typeof monitor.name === 'string') activeNames[monitor.name] = true;
    for (const monitor of all) {
        const name = typeof monitor.name === 'string' ? monitor.name : '';
        const id = Number(monitor.id);
        if (name && Number.isFinite(id)) namesById.set(String(id), name);
    }
    const attached = all.map((monitor) => {
        const mirror = mirrorSource(monitor, namesById);
        const name = typeof monitor.name === 'string' ? monitor.name : '';
        const enabled =
            typeof monitor.disabled === 'boolean'
                ? !monitor.disabled
                : !!activeNames[name] || mirror !== null;
        return monitorFromRaw(monitor, enabled, mirror);
    });
    return {
        attached,
        active: attached.filter(
            (monitor) => monitor.enabled && monitor.mirror === null && !!activeNames[monitor.name]
        ),
        workspaces: workspaceValue === undefined ? {} : parseWorkspaceArray(workspaceValue),
    };
}

const hyprlandAdapter: DisplayAdapter = {
    async snapshot() {
        const [allText, activeText, workspacesText] = await Promise.all([
            Process.execAsyncv(['hyprctl', 'monitors', 'all', '-j']),
            Process.execAsyncv(['hyprctl', 'monitors', '-j']),
            Process.execAsyncv(['hyprctl', 'workspaces', '-j']),
        ]);
        return parseHyprlandSnapshot(
            JSON.parse(allText),
            JSON.parse(activeText),
            JSON.parse(workspacesText)
        );
    },
    async keyword(spec) {
        await Process.execAsyncv(['hyprctl', 'keyword', renderMonitorSpec(spec)], true);
    },
    async workspace(id, monitor) {
        await Process.execAsyncv(
            ['hyprctl', 'keyword', 'workspace', `${id}, monitor:${monitor}`],
            true
        );
    },
};

function identity(spec: Pick<MonitorSpec, 'name' | 'description'>, attached: OutputInfo[]): string {
    if (
        spec.description &&
        attached.filter((monitor) => monitor.description === spec.description).length === 1
    )
        return `edid:${spec.description}`;
    return `connector:${spec.name}`;
}

function topology(outputs: OutputInfo[]): string {
    return outputs
        .map((output) => identity(output, outputs))
        .sort()
        .join('\n');
}

function sameIdentitySet(specs: MonitorSpec[], outputs: OutputInfo[]): boolean {
    if (specs.length !== outputs.length) return false;
    return (
        specs
            .map((spec) => identity(spec, outputs))
            .sort()
            .join('\n') === topology(outputs)
    );
}

function specFromOutput(output: OutputInfo, disabled = !output.enabled): MonitorSpec {
    return {
        name: output.name,
        description: output.description,
        resolution: output.resolution,
        position: output.position,
        scale: output.scale,
        transform: output.transform,
        vrr: output.vrr,
        disabled,
        mirror: normalizedMirror(output.mirror),
    };
}

class LayoutWriteFailure extends Error {
    constructor(
        message: string,
        readonly changed: boolean
    ) {
        super(message);
    }
}
type LayoutWriteState = {changed: boolean};

function validateMirrorGraph(specs: MonitorSpec[]): void {
    const byName = new Map<string, MonitorSpec>();
    for (const spec of specs) {
        if (byName.has(spec.name)) throw new Error('Invalid mirror configuration');
        byName.set(spec.name, spec);
    }
    for (const spec of specs) {
        if (spec.disabled || !spec.mirror) continue;
        const source = byName.get(spec.mirror);
        if (!source || source.disabled || source.name === spec.name || source.mirror)
            throw new Error('Invalid mirror configuration');
    }
    if (!specs.some((spec) => !spec.disabled && !spec.mirror))
        throw new Error('Invalid mirror configuration');
}

function isDisplayMode(value: string): value is DisplayMode {
    return (
        value === 'internal-only' ||
        value === 'external-only' ||
        value === 'extend' ||
        value === 'duplicate'
    );
}

function sameLayout(a: Layout | undefined, b: Layout): boolean {
    return (
        !!a &&
        JSON.stringify(normalizeLayout(a).monitors) === JSON.stringify(normalizeLayout(b).monitors)
    );
}

@register
export class LayoutService extends GObject {
    private static instance: LayoutService | null = null;
    static get_default(): LayoutService {
        if (!LayoutService.instance) LayoutService.instance = new LayoutService();
        return LayoutService.instance;
    }
    static testReset(): void {
        LayoutService.instance = null;
    }
    #store: LayoutStore;
    #loaded = false;
    #storeValid = true;
    #storePath: string;
    #autoApply: () => boolean;
    #adapter: DisplayAdapter;
    #schedule: (delay: number, callback: () => void | Promise<void>) => number;
    #cancel: (id: number) => void;
    #deadline: number | null = null;
    #error: string | null = null;
    #outputs: OutputInfo[] = [];
    #busy: Promise<unknown> = Promise.resolve();
    #seedDefault: string | null = null;
    #topology = '';
    #lastEnabled = new Map<string, MonitorSpec>();
    #monitorIds: number[] = [];
    #initialized = false;
    #pendingLayout: Layout | null = null;
    #pendingBefore: DisplaySnapshot | null = null;
    #pendingOriginalLayout: Layout | null = null;
    #pendingOriginalName: string | null = null;
    #previewTimer: number | null = null;
    #previewGeneration = 0;
    #hotplugTimer: number | null = null;

    constructor(options: LayoutServiceOptions = {}) {
        super();
        this.#store = {...EMPTY_STORE, layouts: {}};
        this.#storePath = options.storePath ?? defaultStorePath();
        this.#autoApply = options.autoApply ?? (() => monitorsSettings().autoApply.peek());
        this.#adapter = options.adapter ?? hyprlandAdapter;
        this.#schedule = options.schedule ?? defaultSchedule;
        this.#cancel = options.cancel ?? ((id) => GLib.Source.remove(id));
    }

    @property get names(): string[] {
        return Object.keys(this.#load().layouts).sort();
    }
    @property get current(): string | null {
        return this.#load().current;
    }
    @property get monitors(): OutputInfo[] {
        return this.#outputs;
    }
    @property get autoApply(): boolean {
        return this.#autoApply();
    }
    @property get pending(): number | null {
        return this.#deadline;
    }
    @property get error(): string | null {
        return this.#error;
    }
    @property get displayMode(): string {
        return detectDisplayMode(this.#outputs);
    }
    @property get availableDisplayModes(): string[] {
        return getAvailableDisplayModes(this.#outputs);
    }
    @signal modeChooserRequested(): void {}
    @signal applied(_name: string): void {}
    drawArrangement(cr: Cairo.Context, width: number, height: number, layout: Layout): void {
        let rightEdge = 0;
        const rectangles = layout.monitors.flatMap((spec) => {
            if (spec.disabled || spec.mirror) return [];
            const output = this.#outputs.find((item) => item.name === spec.name);
            if (!output) return [];
            const match = /^(-?\d+)x(-?\d+)$/.exec(spec.position);
            const size = logicalMonitorSize(spec, output);
            const x = spec.position === 'auto-right' ? rightEdge : Number(match?.[1] ?? output.x);
            const y = spec.position === 'auto-right' ? 0 : Number(match?.[2] ?? output.y);
            rightEdge = Math.max(rightEdge, x + size.width);
            return [{output, x, y, width: size.width, height: size.height}];
        });
        if (!rectangles.length) return;
        const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
        const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
        const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
        const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
        const scale = Math.min(
            (width - 24) / Math.max(1, right - left),
            (height - 24) / Math.max(1, bottom - top)
        );
        for (const rectangle of rectangles) {
            cr.setSourceRGB(0.22, 0.42, 0.65);
            cr.rectangle(
                12 + (rectangle.x - left) * scale,
                12 + (rectangle.y - top) * scale,
                rectangle.width * scale,
                rectangle.height * scale
            );
            cr.fillPreserve();
            cr.setSourceRGB(0.8, 0.85, 0.95);
            cr.stroke();
            cr.moveTo(18 + (rectangle.x - left) * scale, 30 + (rectangle.y - top) * scale);
            cr.showText(rectangle.output.name);
        }
    }
    registerCommands(app: Gio.Application): void {
        const action = Gio.SimpleAction.new('display-next', null);
        action.connect('activate', () => {
            void this.next();
        });
        app.add_action(action);
    }
    @signal storeChanged(): void {}

    init(): void {
        if (this.#initialized) return;
        this.#initialized = true;
        const hyprland = getHyprland();
        if (hyprland)
            this.#monitorIds = [
                hyprland.connect('monitor-added', () => this.#scheduleReconcile()),
                hyprland.connect('monitor-removed', () => this.#scheduleReconcile()),
            ];
        void this.#reconcile(true);
    }

    dispose(): void {
        if (this.#previewTimer !== null) this.#cancel(this.#previewTimer);
        if (this.#hotplugTimer !== null) this.#cancel(this.#hotplugTimer);
        const hyprland = getHyprland();
        if (hyprland) this.#monitorIds.forEach((id) => hyprland.disconnect(id));
        this.#monitorIds = [];
        this.#initialized = false;
    }

    #enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#busy.then(operation, operation);
        this.#busy = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    #setError(error: unknown): void {
        this.#error = error instanceof Error ? error.message : String(error);
        this.notify('error');
        logger.error('layouts', this.#error);
    }
    #publishOutputs(outputs: OutputInfo[]): void {
        this.#outputs = outputs;
        this.notify('monitors');
        this.notify('displayMode');
        this.notify('availableDisplayModes');
    }

    #load(): LayoutStore {
        if (this.#loaded) return this.#store;
        try {
            this.#store = parseStore(JSON.parse(readFile(this.#storePath)));
        } catch (error) {
            if (missingFile(error)) this.#seed();
            else {
                this.#storeValid = false;
                this.#setError(error);
            }
        }
        this.#loaded = true;
        return this.#store;
    }

    #seed(): void {
        try {
            const raw: unknown = JSON.parse(
                readFile('/etc/xdg/shade/initial-monitor-layouts.json')
            );
            if (
                typeof raw !== 'object' ||
                raw === null ||
                Array.isArray(raw) ||
                !('layouts' in raw)
            )
                throw new Error('Invalid initial monitor layout seed');
            const seed = raw as {
                layouts: Record<
                    string,
                    Omit<Layout, 'monitors'> & {
                        monitors: (Partial<MonitorSpec> &
                            Pick<MonitorSpec, 'name'> & {desc?: string; disable?: boolean})[];
                    }
                >;
                defaultLayout?: string;
            };
            if (typeof seed.layouts !== 'object' || !seed.layouts)
                throw new Error('Invalid initial monitor layout seed');
            this.#seedDefault = seed.defaultLayout ?? null;
            const layouts: Record<string, Layout> = {};
            for (const [name, layout] of Object.entries(seed.layouts)) {
                layouts[name] = {
                    auto: layout.auto,
                    workspaces: layout.workspaces ?? {},
                    monitors: layout.monitors.map((monitor) => ({
                        name: monitor.name,
                        description: monitor.desc ?? monitor.description,
                        resolution: monitor.resolution ?? 'preferred',
                        position: monitor.position ?? 'auto',
                        scale: monitor.scale ?? 1,
                        transform: monitor.transform ?? 0,
                        vrr: monitor.vrr ?? null,
                        mirror: normalizedMirror(monitor.mirror),
                        disabled: monitor.disable ?? monitor.disabled ?? false,
                    })),
                };
            }
            this.#store.layouts = layouts;
            if (!this.#persist()) this.#store = {...EMPTY_STORE, layouts: {}};
        } catch (error) {
            if (!missingFile(error)) this.#setError(error);
        }
    }

    #persist(): boolean {
        if (!this.#storeValid) return false;
        try {
            writeFile(this.#storePath, JSON.stringify(this.#store, null, 2));
            return true;
        } catch (error) {
            this.#setError(error);
            return false;
        }
    }

    #scheduleReconcile(): void {
        if (this.#hotplugTimer !== null) this.#cancel(this.#hotplugTimer);
        this.#hotplugTimer = this.#schedule(500, () => {
            this.#hotplugTimer = null;
            void this.#reconcile(false);
        });
    }

    async reconcileNow(): Promise<void> {
        await this.#reconcile(false);
    }
    async #reconcile(startup: boolean): Promise<void> {
        await this.#enqueue(async () => {
            let snapshot: DisplaySnapshot;
            try {
                snapshot = await this.#adapter.snapshot();
            } catch (error) {
                this.#setError(error);
                return;
            }
            await this.#reconcileSnapshot(startup, snapshot);
        });
    }

    async #reconcileSnapshot(startup: boolean, snapshot: DisplaySnapshot): Promise<void> {
        const changed = this.#topology !== topology(snapshot.attached);
        this.#topology = topology(snapshot.attached);
        this.#publishOutputs(snapshot.attached);
        if (this.#pendingBefore && changed) this.#clearPreview();
        if (!snapshot.active.some((monitor) => monitor.enabled && !monitor.mirror)) {
            const internal = snapshot.attached
                .filter((monitor) => /^eDP-/.test(monitor.name))
                .sort((a, b) => a.name.localeCompare(b.name))[0];
            if (!internal) {
                this.#setError(
                    new Error('No active display and no attached internal panel to recover')
                );
                return;
            }
            try {
                await this.#adapter.keyword({
                    ...specFromOutput(internal, false),
                    resolution: 'preferred',
                    position: 'auto',
                    scale: 1,
                    transform: 0,
                    vrr: null,
                    mirror: null,
                });
                const recovered = await this.#adapter.snapshot();
                this.#publishOutputs(recovered.attached);
                if (
                    !recovered.active.some(
                        (monitor) =>
                            monitor.name === internal.name &&
                            monitor.enabled &&
                            monitor.mirror === null
                    )
                )
                    throw new Error('Display recovery did not activate the internal panel');
            } catch (error) {
                this.#setError(error);
                notify('Display recovery failed', String(error), 'dialog-error-symbolic');
            }
            return;
        }
        if ((!startup && !changed) || !this.#autoApply()) return;
        const matches = Object.entries(this.#load().layouts).filter(
            ([, layout]) =>
                layout.auto !== false && sameIdentitySet(layout.monitors, snapshot.attached)
        );
        const selected =
            matches.find(([name]) => name === this.#store.current) ??
            matches.find(([name]) => name === this.#seedDefault) ??
            matches.sort(([a], [b]) => a.localeCompare(b))[0];
        if (selected) await this.#applyCommitted(selected[0], selected[1], snapshot);
    }

    #clearPreview(): void {
        this.#previewGeneration++;
        if (this.#previewTimer !== null) this.#cancel(this.#previewTimer);
        this.#previewTimer = null;
        this.#deadline = null;
        this.#pendingLayout = null;
        this.#pendingOriginalLayout = null;
        this.#pendingBefore = null;
        this.#pendingOriginalName = null;
        this.notify('pending');
    }

    #resolve(spec: MonitorSpec, outputs: OutputInfo[]): OutputInfo | null {
        if (spec.description) {
            const matches = outputs.filter((monitor) => monitor.description === spec.description);
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) {
                const connector = matches.find((monitor) => monitor.name === spec.name);
                if (connector) return connector;
                throw new Error(`Ambiguous display description: ${spec.description}`);
            }
        }
        return outputs.find((monitor) => monitor.name === spec.name) ?? null;
    }

    #resolvedSpec(spec: MonitorSpec, outputs: OutputInfo[]): MonitorSpec {
        const output = this.#resolve(spec, outputs);
        if (!output) throw new Error(`Display is not attached: ${spec.name}`);
        return {
            ...spec,
            name: output.name,
            description: output.description,
            mirror: normalizedMirror(spec.mirror),
        };
    }

    #validatedSpecs(layout: Layout, before: DisplaySnapshot): MonitorSpec[] {
        const attachedNames = new Set(before.attached.map((output) => output.name));
        if (attachedNames.size !== before.attached.length)
            throw new Error('Invalid mirror configuration');
        const profileNames = new Map<string, MonitorSpec>();
        const resolvedNames = new Set<string>();
        const specs = layout.monitors.map((monitor) => {
            if (profileNames.has(monitor.name)) throw new Error('Invalid mirror configuration');
            const resolved = this.#resolvedSpec(monitor, before.attached);
            if (resolvedNames.has(resolved.name)) throw new Error('Invalid mirror configuration');
            profileNames.set(monitor.name, resolved);
            resolvedNames.add(resolved.name);
            return resolved;
        });
        for (const [index, monitor] of layout.monitors.entries()) {
            const reference = normalizedMirror(monitor.mirror);
            if (!reference || specs[index].disabled) continue;
            const source = profileNames.get(reference);
            if (!source) throw new Error('Invalid mirror configuration');
            specs[index].mirror = source.name;
        }
        if (!specs.some((monitor) => !monitor.disabled))
            throw new Error('A layout must enable at least one attached display');
        const all = [
            ...specs,
            ...before.attached
                .filter((monitor) => !resolvedNames.has(monitor.name))
                .map((monitor) => specFromOutput(monitor, true)),
        ];
        validateMirrorGraph(all);
        return all;
    }

    #sameTopology(a: OutputInfo[], b: OutputInfo[]): boolean {
        return topology(a) === topology(b);
    }

    async #configureIndependent(
        specs: MonitorSpec[],
        before: DisplaySnapshot,
        state: LayoutWriteState
    ): Promise<void> {
        for (const spec of specs) {
            state.changed = true;
            await this.#adapter.keyword(spec);
        }
        const snapshot = await this.#adapter.snapshot();
        if (!this.#sameTopology(before.attached, snapshot.attached))
            throw new Error('Attached displays changed while applying layout');
        if (
            !specs.every((spec) =>
                snapshot.active.some(
                    (output) =>
                        output.name === spec.name && output.enabled && output.mirror === null
                )
            )
        )
            throw new Error('Layout left no active display');
    }

    async #configureMirrorsAndDisabled(
        specs: MonitorSpec[],
        mirrors: MonitorSpec[],
        beforeByName: Map<string, OutputInfo>,
        state: LayoutWriteState
    ): Promise<DisplaySnapshot> {
        for (const spec of mirrors) {
            state.changed = true;
            await this.#adapter.keyword(spec);
        }
        for (const spec of specs) {
            if (!spec.disabled || !beforeByName.get(spec.name)?.enabled) continue;
            state.changed = true;
            await this.#adapter.keyword(spec);
        }
        return this.#adapter.snapshot();
    }

    #verifyWrittenLayout(
        before: DisplaySnapshot,
        snapshot: DisplaySnapshot,
        specs: MonitorSpec[],
        independent: MonitorSpec[]
    ): void {
        if (!this.#sameTopology(before.attached, snapshot.attached))
            throw new Error('Attached displays changed while applying layout');
        const activeNames = snapshot.active
            .filter((output) => output.enabled && !output.mirror)
            .map((output) => output.name)
            .sort();
        const expectedActiveNames = independent.map((spec) => spec.name).sort();
        if (JSON.stringify(activeNames) !== JSON.stringify(expectedActiveNames))
            throw new Error('Layout left no active display');
        const liveByName = new Map(snapshot.attached.map((output) => [output.name, output]));
        for (const expected of specs) {
            const live = liveByName.get(expected.name);
            if (!live || live.enabled === expected.disabled)
                throw new Error('Invalid mirror configuration');
            if (
                !expected.disabled &&
                normalizedMirror(live.mirror) !== normalizedMirror(expected.mirror)
            )
                throw new Error('Invalid mirror configuration');
        }
    }

    async #assignWorkspaces(layout: Layout, independent: MonitorSpec[]): Promise<void> {
        for (const [workspaceId, monitorName] of Object.entries(layout.workspaces)) {
            const monitor = independent.find((spec) => spec.name === monitorName);
            const id = Number(workspaceId);
            if (monitor && Number.isInteger(id)) await this.#adapter.workspace(id, monitor.name);
        }
    }

    async #writeLayout(layout: Layout, before: DisplaySnapshot): Promise<DisplaySnapshot> {
        let specs: MonitorSpec[];
        try {
            specs = this.#validatedSpecs(layout, before);
        } catch (error) {
            throw new LayoutWriteFailure(
                error instanceof Error ? error.message : String(error),
                false
            );
        }
        const independent = specs.filter((spec) => !spec.disabled && !spec.mirror);
        const mirrors = specs.filter((spec) => !spec.disabled && !!spec.mirror);
        const beforeByName = new Map(before.attached.map((output) => [output.name, output]));
        const state: LayoutWriteState = {changed: false};
        try {
            for (const output of before.attached)
                if (output.enabled)
                    this.#lastEnabled.set(output.name, specFromOutput(output, false));
            await this.#configureIndependent(independent, before, state);
            const snapshot = await this.#configureMirrorsAndDisabled(
                specs,
                mirrors,
                beforeByName,
                state
            );
            this.#verifyWrittenLayout(before, snapshot, specs, independent);
            await this.#assignWorkspaces(layout, independent);
            return snapshot;
        } catch (error) {
            if (error instanceof LayoutWriteFailure) throw error;
            throw new LayoutWriteFailure(
                error instanceof Error ? error.message : String(error),
                state.changed
            );
        }
    }

    async #restoreSnapshot(before: DisplaySnapshot, previous: Layout | null): Promise<void> {
        const now = await this.#adapter.snapshot().catch(() => null);
        if (!now || !this.#sameTopology(before.attached, now.attached)) return;
        const rollback: Layout = {
            monitors: before.attached.map((monitor) => specFromOutput(monitor, !monitor.enabled)),
            workspaces: before.workspaces ?? previous?.workspaces ?? {},
        };
        try {
            const restored = await this.#writeLayout(rollback, now);
            this.#publishOutputs(restored.attached);
        } catch (error) {
            this.#setError(error);
        }
    }

    async #applyCommitted(
        name: string,
        layout: Layout,
        original?: DisplaySnapshot
    ): Promise<boolean> {
        let before: DisplaySnapshot;
        try {
            before = original ?? (await this.#adapter.snapshot());
        } catch (error) {
            this.#setError(error);
            return false;
        }
        const currentName = this.#load().current;
        const previous = currentName ? (this.#store.layouts[currentName] ?? null) : null;
        try {
            const after = await this.#writeLayout(layout, before);
            this.#publishOutputs(after.attached);
            this.#store.current = name;
            this.#persist();
            this.notify('current');
            this.applied(name);
            return true;
        } catch (error) {
            this.#setError(error);
            if (error instanceof LayoutWriteFailure && error.changed)
                await this.#restoreSnapshot(before, previous);
            return false;
        }
    }

    get(name: string): Layout | null {
        return this.#load().layouts[name] ?? null;
    }

    save(name: string, layout?: Layout): boolean {
        this.#load();
        if (!this.#storeValid) return false;
        const key = name.trim();
        if (!key) return false;
        const next = normalizeLayout(layout ?? this.captureLayout());
        if (!next.monitors.length) return false;
        const previous = this.#store.layouts[key];
        this.#store.layouts[key] = next;
        if (!this.#persist()) {
            if (previous) this.#store.layouts[key] = previous;
            else delete this.#store.layouts[key];
            return false;
        }
        this.notify('names');
        this.storeChanged();
        return true;
    }

    remove(name: string): boolean {
        if (!(name in this.#load().layouts)) return false;
        const previous = this.#store.layouts[name];
        delete this.#store.layouts[name];
        if (!this.#persist()) {
            this.#store.layouts[name] = previous;
            return false;
        }
        if (this.#store.current === name) {
            this.#store.current = null;
            this.notify('current');
        }
        this.notify('names');
        this.storeChanged();
        return true;
    }

    captureLayout(): Layout {
        return {
            monitors: this.#outputs.map((monitor) => specFromOutput(monitor, !monitor.enabled)),
            workspaces: {},
        };
    }

    async apply(name: string): Promise<boolean> {
        const layout = this.get(name);
        if (!layout) return false;
        return this.#enqueue(() => this.#applyCommitted(name, layout));
    }

    #layoutFromSnapshot(snapshot: DisplaySnapshot): Layout {
        return {
            monitors: snapshot.attached.map((output) => specFromOutput(output)),
            workspaces: {},
        };
    }

    #modeInputs(snapshot: DisplaySnapshot): OutputInfo[] {
        return snapshot.attached.map((output) => {
            if (output.enabled) return output;
            const cached = this.#lastEnabled.get(output.name);
            if (!cached) return output;
            return {
                ...output,
                ...cached,
                name: output.name,
                description: output.description,
                id: output.id,
                enabled: false,
                disabled: true,
            };
        });
    }

    #toggleLayout(snapshot: DisplaySnapshot, name: string, enabled: boolean): Layout | null {
        const output = snapshot.attached.find((monitor) => monitor.name === name);
        if (!output) {
            this.#setError(`Display is not attached: ${name}`);
            return null;
        }
        let layout = this.#layoutFromSnapshot(snapshot);
        if (enabled && !output.enabled) {
            const cached = this.#lastEnabled.get(name);
            const noUsableMode =
                output.resolution === 'preferred' && !(output.width > 0 && output.height > 0);
            let replacement: MonitorSpec | null = null;
            if (cached) {
                replacement = {
                    ...specFromOutput(output, true),
                    ...cached,
                    name: output.name,
                    description: output.description,
                    disabled: true,
                };
            } else if (noUsableMode) {
                replacement = {
                    ...specFromOutput(output, true),
                    resolution: 'preferred',
                    position: 'auto-right',
                    scale: 1,
                    transform: 0,
                    vrr: null,
                    mirror: null,
                };
            }
            if (replacement) {
                layout = {
                    ...layout,
                    monitors: layout.monitors.map((monitor) =>
                        monitor.name === name ? replacement : monitor
                    ),
                };
            }
        }
        const toggled = setLayoutOutputEnabled(layout, name, enabled);
        if (!toggled) {
            const current = layout.monitors.find((monitor) => monitor.name === name);
            const independent = layout.monitors.filter(
                (monitor) => !monitor.disabled && !monitor.mirror
            );
            const hasDependents = layout.monitors.some(
                (monitor) => !monitor.disabled && monitor.mirror === name
            );
            if (
                !enabled &&
                current &&
                !current.disabled &&
                !current.mirror &&
                independent.length === 1 &&
                !hasDependents
            )
                this.#setError('Cannot disable the last enabled display');
            else this.#setError('Invalid mirror configuration');
            return null;
        }
        return enabled ? this.#placeNonOverlapping(toggled, name, snapshot) : toggled;
    }

    #placeNonOverlapping(layout: Layout, name: string, snapshot: DisplaySnapshot): Layout {
        const target = layout.monitors.find((monitor) => monitor.name === name);
        const output = snapshot.attached.find((monitor) => monitor.name === name);
        if (
            !target ||
            !output ||
            target.disabled ||
            target.mirror ||
            target.position === 'auto-right'
        )
            return layout;
        const position = /^(-?\d+)x(-?\d+)$/.exec(target.position);
        const x = Number(position?.[1] ?? output.x);
        const y = Number(position?.[2] ?? output.y);
        const size = logicalMonitorSize(target, output);
        for (const other of layout.monitors) {
            if (other.name === name || other.disabled || other.mirror) continue;
            const otherOutput = snapshot.attached.find((monitor) => monitor.name === other.name);
            if (!otherOutput) continue;
            const otherPosition = /^(-?\d+)x(-?\d+)$/.exec(other.position);
            const otherX = Number(otherPosition?.[1] ?? otherOutput.x);
            const otherY = Number(otherPosition?.[2] ?? otherOutput.y);
            const otherSize = logicalMonitorSize(other, otherOutput);
            if (
                x < otherX + otherSize.width &&
                x + size.width > otherX &&
                y < otherY + otherSize.height &&
                y + size.height > otherY
            )
                return {
                    ...layout,
                    monitors: layout.monitors.map((monitor) =>
                        monitor.name === name ? {...monitor, position: 'auto-right'} : monitor
                    ),
                };
        }
        return layout;
    }

    async #snapshotOrError(): Promise<DisplaySnapshot | null> {
        try {
            return await this.#adapter.snapshot();
        } catch (error) {
            this.#setError(error);
            return null;
        }
    }

    async setEnabled(name: string, enabled: boolean): Promise<boolean> {
        return this.#enqueue(async () => {
            const before = await this.#snapshotOrError();
            if (!before) return false;
            const output = before.attached.find((monitor) => monitor.name === name);
            if (!output) {
                this.#setError(`Display is not attached: ${name}`);
                return false;
            }
            if (output.enabled === enabled) return true;
            const layout = this.#toggleLayout(before, name, enabled);
            if (!layout) return false;
            return this.#previewLayout(layout, before);
        });
    }

    #modeMatches(layout: Layout, snapshot: DisplaySnapshot): boolean {
        if (layout.monitors.length !== snapshot.attached.length) return false;
        const outputs = new Map(snapshot.attached.map((output) => [output.name, output]));
        for (const spec of layout.monitors) {
            const output = outputs.get(spec.name);
            if (!output || output.enabled === spec.disabled) return false;
            if (!spec.disabled && (output.mirror ?? null) !== (spec.mirror ?? null)) return false;
        }
        let rightEdge = 0;
        for (const spec of layout.monitors) {
            if (spec.disabled || spec.mirror) continue;
            const output = outputs.get(spec.name);
            if (!output) return false;
            const position = /^(-?\d+)x(-?\d+)$/.exec(spec.position);
            const x =
                spec.position === 'auto-right' ? rightEdge : Number(position?.[1] ?? output.x);
            const y = spec.position === 'auto-right' ? 0 : Number(position?.[2] ?? output.y);
            if (output.x !== x || output.y !== y) return false;
            rightEdge = Math.max(rightEdge, x + logicalMonitorSize(spec, output).width);
        }
        return true;
    }

    #unavailableModeError(mode: string, outputs: OutputInfo[]): string {
        if (
            mode !== 'internal-only' &&
            mode !== 'external-only' &&
            mode !== 'extend' &&
            mode !== 'duplicate'
        )
            return `Unknown display mode: ${mode}`;
        const hasPanel = outputs.some((output) => /^eDP-/.test(output.name));
        const hasExternal = outputs.some((output) => !/^eDP-/.test(output.name));
        if (mode === 'internal-only' && !hasPanel) return 'No internal display is attached';
        if (mode === 'external-only') {
            if (!hasExternal) return 'No external displays are attached';
            if (!hasPanel) return 'No internal display is attached';
        }
        if (mode === 'duplicate' && outputs.length < 2)
            return 'Duplicate needs at least two attached displays';
        if (mode === 'extend' && outputs.length < 2)
            return 'Extend needs at least two attached displays';
        return `Display mode is unavailable: ${mode}`;
    }

    async previewMode(mode: DisplayMode): Promise<boolean> {
        return this.#enqueue(async () => {
            this.#load();
            const before = await this.#snapshotOrError();
            if (!before) return false;
            const modeName = String(mode);
            if (!isDisplayMode(modeName)) {
                this.#setError(this.#unavailableModeError(modeName, before.attached));
                return false;
            }
            const layout = buildDisplayMode(modeName, this.#modeInputs(before));
            if (!layout) {
                this.#setError(this.#unavailableModeError(modeName, before.attached));
                return false;
            }
            if (this.#modeMatches(layout, before)) return true;
            return this.#previewLayout(layout, before);
        });
    }

    openModeChooser(): void {
        ShellState.get_default().qsOpen = true;
        this.modeChooserRequested();
    }

    async toggleInternal(): Promise<boolean> {
        return this.#enqueue(async () => {
            const before = await this.#snapshotOrError();
            if (!before) return false;
            const panel = before.attached
                .filter((output) => /^eDP-/.test(output.name))
                .sort((a, b) => a.name.localeCompare(b.name))[0];
            if (!panel) {
                this.#setError('No internal display is attached');
                return false;
            }
            const enabled = !panel.enabled;
            const layout = this.#toggleLayout(before, panel.name, enabled);
            if (!layout) return false;
            const applied = await this.#previewLayout(layout, before);
            if (applied) ShellState.get_default().qsOpen = true;
            return applied;
        });
    }

    async setDpms(name: string, on: boolean): Promise<boolean> {
        return this.#enqueue(async () => {
            try {
                await Process.execAsyncv(
                    ['hyprctl', 'dispatch', 'dpms', on ? 'on' : 'off', name],
                    true
                );
                const snapshot = await this.#adapter.snapshot();
                this.#publishOutputs(snapshot.attached);
                return true;
            } catch (error) {
                this.#setError(error);
                return false;
            }
        });
    }

    async preview(layout: Layout): Promise<boolean> {
        return this.#enqueue(async () => {
            this.#load();
            const before = await this.#snapshotOrError();
            if (!before) return false;
            return this.#previewLayout(layout, before);
        });
    }

    async #previewLayout(layout: Layout, before: DisplaySnapshot): Promise<boolean> {
        this.#load();
        const replacing = this.#pendingBefore !== null;
        const previousName = replacing ? this.#pendingOriginalName : this.#store.current;
        let previousLayout: Layout | null = null;
        if (replacing) previousLayout = this.#pendingOriginalLayout;
        else if (previousName) previousLayout = this.#store.layouts[previousName] ?? null;
        const immediateLayout = replacing ? this.#pendingLayout : previousLayout;
        try {
            const after = await this.#writeLayout(layout, before);
            this.#publishOutputs(after.attached);
            if (!replacing) {
                this.#pendingBefore = before;
                this.#pendingOriginalLayout = previousLayout;
                this.#pendingOriginalName = previousName;
            }
            this.#pendingLayout = normalizeLayout(layout);
            this.#store.current = null;
            this.notify('current');
            if (this.#previewTimer !== null) this.#cancel(this.#previewTimer);
            const generation = ++this.#previewGeneration;
            this.#deadline = Date.now() + 15_000;
            this.notify('pending');
            this.#previewTimer = this.#schedule(15_000, () =>
                this.#enqueue(async () => {
                    if (generation !== this.#previewGeneration || !this.#pendingLayout) return;
                    this.#previewTimer = null;
                    await this.#revertPreview();
                })
            );
            return true;
        } catch (error) {
            if (error instanceof LayoutWriteFailure && error.changed)
                await this.#restoreSnapshot(before, immediateLayout);
            this.#setError(error);
            return false;
        }
    }

    async confirm(): Promise<boolean> {
        return this.#enqueue(async () => {
            if (!this.#pendingLayout) return false;
            this.#load();
            const currentName = this.#store.current;
            try {
                const live = this.captureLayout();
                this.#store.current =
                    this.names.find((name) => sameLayout(this.#store.layouts[name], live)) ?? null;
                if (!this.#persist()) {
                    this.#store.current = currentName;
                    if (!this.#error) this.#setError('Unable to save display layout');
                    this.notify('current');
                    return false;
                }
                this.#clearPreview();
                this.notify('current');
                return true;
            } catch (error) {
                this.#store.current = currentName;
                this.#setError(error);
                this.notify('current');
                return false;
            }
        });
    }

    async #revertPreview(): Promise<void> {
        const before = this.#pendingBefore;
        if (!before) {
            this.#clearPreview();
            return;
        }
        const previous = this.#pendingOriginalLayout;
        const previousName = this.#pendingOriginalName;
        const now = await this.#snapshotOrError();
        this.#clearPreview();
        if (!now) return;
        if (!this.#sameTopology(before.attached, now.attached)) {
            await this.#reconcileSnapshot(false, now);
            return;
        }
        await this.#restoreSnapshot(before, previous);
        this.#store.current = previousName;
        this.notify('current');
    }

    async revert(): Promise<void> {
        await this.#enqueue(() => this.#revertPreview());
    }

    async next(): Promise<boolean> {
        const snapshot = await this.#adapter.snapshot();
        const candidates = this.names.filter((name) => {
            const layout = this.#store.layouts[name];
            return layout.auto !== false && sameIdentitySet(layout.monitors, snapshot.attached);
        });
        if (candidates.length < 2) {
            notify(
                'No alternative display layout',
                'No other saved layout matches the attached displays.'
            );
            return false;
        }
        const index = candidates.indexOf(this.current ?? '');
        const ok = await this.preview(
            this.#store.layouts[candidates[(index + 1) % candidates.length]]
        );
        if (ok) ShellState.get_default().qsOpen = true;
        return ok;
    }
}

defineService({name: 'LayoutService', service: LayoutService.get_default()});
export default LayoutService;
