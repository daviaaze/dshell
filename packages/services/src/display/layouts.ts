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

export interface MonitorSpec {
    name: string;
    description?: string;
    resolution: string;
    position: string;
    scale: number;
    transform: number;
    vrr: number | null;
    disabled: boolean;
}

export interface OutputInfo extends MonitorSpec {
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
    return {...EMPTY_STORE, ...parsed};
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
function monitorFromRaw(raw: RawMonitor, enabled: boolean): OutputInfo {
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name) throw new Error('Hyprland returned a monitor without a connector name');
    const description =
        typeof raw.description === 'string' && raw.description ? raw.description : undefined;
    const x = Number(raw.x ?? 0);
    const y = Number(raw.y ?? 0);
    const width = Number(raw.width ?? 0);
    const height = Number(raw.height ?? 0);
    const scale = Number(raw.scale ?? 1);
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
        name,
        description,
        resolution,
        position: `${x}x${y}`,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        transform: Number(raw.transform ?? 0),
        vrr: raw.vrr ? 1 : 0,
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
    const all = parseMonitorArray(allValue);
    const active = parseMonitorArray(activeValue);
    const activeNames: Record<string, true> = {};
    for (const monitor of active)
        if (typeof monitor.name === 'string') activeNames[monitor.name] = true;
    const attached = all.map((monitor) =>
        monitorFromRaw(monitor, !!activeNames[String(monitor.name)])
    );
    return {
        attached,
        active: attached.filter((monitor) => monitor.enabled),
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

function sameLayout(a: Layout | undefined, b: Layout): boolean {
    return !!a && JSON.stringify(a.monitors) === JSON.stringify(b.monitors);
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
    @signal applied(_name: string): void {}
    drawArrangement(cr: Cairo.Context, width: number, height: number, layout: Layout): void {
        const enabled = layout.monitors
            .map((spec) => ({
                spec,
                output: this.#outputs.find((output) => output.name === spec.name),
            }))
            .filter((item) => item.output && !item.spec.disabled);
        if (!enabled.length) return;
        const positions = enabled.map(({spec}) => {
            const parts = spec.position.split('x').map(Number);
            return {x: parts[0] ?? 0, y: parts[1] ?? 0};
        });
        const left = Math.min(...positions.map((position) => position.x));
        const top = Math.min(...positions.map((position) => position.y));
        const right = Math.max(
            ...enabled.map(
                ({spec, output}) =>
                    (spec.position.split('x').map(Number)[0] ?? 0) +
                    (output?.width ?? 0) / (output?.scale ?? 1)
            )
        );
        const bottom = Math.max(
            ...enabled.map(
                ({spec, output}) =>
                    (spec.position.split('x').map(Number)[1] ?? 0) +
                    (output?.height ?? 0) / (output?.scale ?? 1)
            )
        );
        const scale = Math.min(
            (width - 24) / Math.max(1, right - left),
            (height - 24) / Math.max(1, bottom - top)
        );
        for (const {spec, output} of enabled) {
            if (!output) continue;
            const [x, y] = spec.position.split('x').map(Number);
            const w = (output.width / output.scale) * scale;
            const h = (output.height / output.scale) * scale;
            cr.setSourceRGB(0.22, 0.42, 0.65);
            cr.rectangle(12 + ((x ?? 0) - left) * scale, 12 + ((y ?? 0) - top) * scale, w, h);
            cr.fillPreserve();
            cr.setSourceRGB(0.8, 0.85, 0.95);
            cr.stroke();
            cr.moveTo(18 + ((x ?? 0) - left) * scale, 30 + ((y ?? 0) - top) * scale);
            cr.showText(output.name);
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
        this.#error = String(error);
        this.notify('error');
        logger.error('layouts', this.#error);
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
            const changed = this.#topology !== topology(snapshot.attached);
            this.#topology = topology(snapshot.attached);
            this.#outputs = snapshot.attached;
            this.notify('monitors');
            if (this.#deadline !== null && changed) this.#clearPreview();
            if (!snapshot.active.length) {
                const internal = snapshot.attached.find((monitor) => /^eDP-/.test(monitor.name));
                if (!internal) {
                    this.#setError(
                        new Error('No active display and no attached internal panel to recover')
                    );
                    return;
                }
                try {
                    await this.#adapter.keyword({
                        ...internal,
                        resolution: 'preferred',
                        position: 'auto',
                        scale: 1,
                        transform: 0,
                        vrr: null,
                        disabled: false,
                    });
                    this.#outputs = (await this.#adapter.snapshot()).attached;
                    this.notify('monitors');
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
        });
    }

    #clearPreview(): void {
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
        return {...spec, name: output.name, description: output.description};
    }

    #sameTopology(a: OutputInfo[], b: OutputInfo[]): boolean {
        return topology(a) === topology(b);
    }

    async #writeLayout(layout: Layout, before: DisplaySnapshot): Promise<DisplaySnapshot> {
        const specs = layout.monitors.map((monitor) =>
            this.#resolvedSpec(monitor, before.attached)
        );
        if (!specs.some((monitor) => !monitor.disabled))
            throw new Error('A layout must enable at least one attached display');
        const configured = new Set(specs.map((monitor) => monitor.name));
        const disabled = [
            ...specs.filter((monitor) => monitor.disabled),
            ...before.attached
                .filter((monitor) => !configured.has(monitor.name))
                .map((monitor) => ({...monitor, disabled: true})),
        ];
        for (const spec of specs.filter((monitor) => !monitor.disabled))
            await this.#adapter.keyword(spec);
        let snapshot = await this.#adapter.snapshot();
        if (!snapshot.active.length) throw new Error('Layout left no active display');
        for (const spec of disabled) await this.#adapter.keyword(spec);
        snapshot = await this.#adapter.snapshot();
        if (!snapshot.active.length) throw new Error('Layout left no active display');
        for (const [workspaceId, monitorName] of Object.entries(layout.workspaces)) {
            const monitor = specs.find(
                (spec) =>
                    spec.name === monitorName &&
                    !spec.disabled &&
                    snapshot.active.some((output) => output.name === spec.name)
            );
            const id = Number(workspaceId);
            if (monitor && Number.isInteger(id)) await this.#adapter.workspace(id, monitor.name);
        }
        return snapshot;
    }
    async #restoreSnapshot(before: DisplaySnapshot, previous: Layout | null): Promise<void> {
        const now = await this.#adapter.snapshot().catch(() => null);
        if (!now || !this.#sameTopology(before.attached, now.attached)) return;
        const rollback: Layout = {
            monitors: before.attached.map((monitor) => ({
                ...monitor,
                disabled: !monitor.enabled,
            })),
            workspaces: before.workspaces ?? previous?.workspaces ?? {},
        };
        try {
            const restored = await this.#writeLayout(rollback, now);
            this.#outputs = restored.attached;
            this.notify('monitors');
        } catch (error) {
            this.#setError(error);
        }
    }

    async #applyCommitted(
        name: string,
        layout: Layout,
        original?: DisplaySnapshot
    ): Promise<boolean> {
        const before = original ?? (await this.#adapter.snapshot());
        const currentName = this.#load().current;
        const previous = currentName ? (this.#store.layouts[currentName] ?? null) : null;
        try {
            const after = await this.#writeLayout(layout, before);
            this.#outputs = after.attached;
            this.notify('monitors');
            this.#store.current = name;
            this.#persist();
            this.notify('current');
            this.applied(name);
            return true;
        } catch (error) {
            this.#setError(error);
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
        const next = layout ?? this.captureLayout();
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
            monitors: this.#outputs.map((monitor) => ({
                name: monitor.name,
                description: monitor.description,
                resolution: monitor.resolution,
                position: monitor.position,
                scale: monitor.scale,
                transform: monitor.transform,
                vrr: monitor.vrr,
                disabled: !monitor.enabled,
            })),
            workspaces: {},
        };
    }

    async apply(name: string): Promise<boolean> {
        const layout = this.get(name);
        if (!layout) return false;
        return this.#enqueue(() => this.#applyCommitted(name, layout));
    }

    async setEnabled(name: string, enabled: boolean): Promise<boolean> {
        return this.#enqueue(async () => {
            const before = await this.#adapter.snapshot();
            const output = before.attached.find((monitor) => monitor.name === name);
            if (!output || (!enabled && before.active.length <= 1)) return false;
            const spec = enabled
                ? (this.#lastEnabled.get(name) ?? {
                      ...output,
                      resolution: 'preferred',
                      position: 'auto',
                      scale: 1,
                      transform: 0,
                      vrr: null,
                      disabled: false,
                  })
                : {...output, disabled: true};
            if (!enabled) this.#lastEnabled.set(name, {...output, disabled: false});
            try {
                await this.#adapter.keyword(spec);
                const after = await this.#adapter.snapshot();
                if (!after.active.length) throw new Error('Cannot disable the last active display');
                this.#outputs = after.attached;
                this.#store.current = null;
                this.notify('monitors');
                this.notify('current');
                return true;
            } catch (error) {
                this.#setError(error);
                return false;
            }
        });
    }

    async setDpms(name: string, on: boolean): Promise<boolean> {
        return this.#enqueue(async () => {
            try {
                await Process.execAsyncv(
                    ['hyprctl', 'dispatch', 'dpms', on ? 'on' : 'off', name],
                    true
                );
                this.#outputs = (await this.#adapter.snapshot()).attached;
                this.notify('monitors');
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
            const previousName = this.#store.current;
            const previous = previousName ? (this.#store.layouts[previousName] ?? null) : null;
            let before: DisplaySnapshot | null = null;
            try {
                before = await this.#adapter.snapshot();
                if (!layout.monitors.some((monitor) => !monitor.disabled)) return false;
                const after = await this.#writeLayout(layout, before);
                this.#outputs = after.attached;
                this.notify('monitors');
                this.#pendingLayout = layout;
                this.#pendingBefore = before;
                this.#pendingOriginalLayout = previous;
                this.#pendingOriginalName = previousName;
                this.#deadline = Date.now() + 15_000;
                this.notify('pending');
                if (this.#previewTimer !== null) this.#cancel(this.#previewTimer);
                this.#previewTimer = this.#schedule(15_000, () => {
                    this.#previewTimer = null;
                    return this.revert();
                });
                this.#store.current = null;
                this.notify('current');
                return true;
            } catch (error) {
                if (before) await this.#restoreSnapshot(before, previous);
                this.#setError(error);
                return false;
            }
        });
    }

    confirm(): void {
        if (!this.#pendingLayout) return;
        this.#clearPreview();
        this.#store.current =
            this.names.find((name) =>
                sameLayout(this.#store.layouts[name], this.captureLayout())
            ) ?? null;
        this.#persist();
        this.notify('current');
    }

    async revert(): Promise<void> {
        await this.#enqueue(async () => {
            const before = this.#pendingBefore;
            const previous = this.#pendingOriginalLayout;
            const previousName = this.#pendingOriginalName;
            const now = await this.#adapter.snapshot().catch(() => null);
            this.#clearPreview();
            if (!before || !now || !this.#sameTopology(before.attached, now.attached)) {
                if (now) void this.#reconcile(false).catch((error) => this.#setError(error));
                return;
            }
            await this.#restoreSnapshot(before, previous);
            this.#store.current = previousName;
            this.notify('current');
        });
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
