import type {Layout, MonitorSpec, OutputInfo} from './layouts';

export type DisplayMode = 'internal-only' | 'external-only' | 'extend' | 'duplicate';

function normalizedMirror(mirror: string | null | undefined): string | null {
    return mirror || null;
}
function isInternalConnector(output: Pick<OutputInfo, 'name'>): boolean {
    return /^eDP-/.test(output.name);
}

function internalPanel(outputs: OutputInfo[]): OutputInfo | undefined {
    return outputs.filter(isInternalConnector).sort((a, b) => a.name.localeCompare(b.name))[0];
}

function ordered(outputs: OutputInfo[]): OutputInfo[] {
    const panel = internalPanel(outputs);
    const others = outputs
        .filter((output) => output !== panel)
        .sort((a, b) => a.name.localeCompare(b.name));
    return panel ? [panel, ...others] : others;
}

function enabledIndependentCount(monitors: MonitorSpec[]): number {
    return monitors.filter((monitor) => !monitor.disabled && !normalizedMirror(monitor.mirror))
        .length;
}

function validMirrorGraph(monitors: MonitorSpec[]): boolean {
    const byName = new Map<string, MonitorSpec>();
    for (const monitor of monitors) {
        if (byName.has(monitor.name)) return false;
        byName.set(monitor.name, monitor);
    }
    for (const monitor of monitors) {
        const mirror = normalizedMirror(monitor.mirror);
        if (monitor.disabled || !mirror) continue;
        const source = byName.get(mirror);
        if (
            !source ||
            source.disabled ||
            source.name === monitor.name ||
            normalizedMirror(source.mirror)
        )
            return false;
    }
    return enabledIndependentCount(monitors) > 0;
}

function modeEnables(
    mode: DisplayMode,
    output: OutputInfo,
    panel: OutputInfo | undefined
): boolean {
    if (mode === 'extend' || mode === 'duplicate') return true;
    if (mode === 'internal-only') return output === panel;
    return output !== panel;
}

function modeSpec(output: OutputInfo): MonitorSpec {
    return {
        name: output.name,
        description: output.description,
        resolution:
            typeof output.resolution === 'string' && output.resolution
                ? output.resolution
                : 'preferred',
        position: typeof output.position === 'string' && output.position ? output.position : 'auto',
        scale: Number.isFinite(output.scale) && output.scale > 0 ? output.scale : 1,
        transform: Number.isFinite(output.transform) ? output.transform : 0,
        vrr: Number.isFinite(output.vrr) ? output.vrr : null,
        disabled: false,
        mirror: null,
    };
}

export function getAvailableDisplayModes(outputs: OutputInfo[]): DisplayMode[] {
    const panel = internalPanel(outputs);
    const hasExternal = outputs.some((output) => output !== panel);
    const multiple = outputs.length >= 2;
    const modes: DisplayMode[] = [];
    if (panel) modes.push('internal-only');
    if (panel && hasExternal) modes.push('external-only');
    if (multiple) modes.push('extend', 'duplicate');
    return modes;
}

export function buildDisplayMode(mode: DisplayMode, outputs: OutputInfo[]): Layout | null {
    if (!getAvailableDisplayModes(outputs).includes(mode)) return null;
    const arranged = ordered(outputs);
    const panel = internalPanel(outputs);
    const source = mode === 'duplicate' ? (panel ?? arranged[0]) : undefined;
    let independentCount = 0;
    const monitors = arranged.map((output) => {
        const spec = modeSpec(output);
        if (!modeEnables(mode, output, panel)) return {...spec, disabled: true};
        if (mode === 'duplicate' && output !== source) {
            return {...spec, position: '0x0', mirror: source?.name ?? null};
        }
        const position = independentCount === 0 ? '0x0' : 'auto-right';
        independentCount++;
        return {...spec, position, mirror: null};
    });
    return {monitors, workspaces: {}};
}

export function detectDisplayMode(outputs: OutputInfo[]): DisplayMode | 'custom' {
    if (!outputs.length) return 'custom';
    const arranged = ordered(outputs);
    const panel = internalPanel(arranged);
    const externals = arranged.filter((output) => output !== panel);
    if (
        panel?.enabled &&
        !normalizedMirror(panel.mirror) &&
        externals.every((output) => !output.enabled)
    )
        return 'internal-only';
    if (
        panel &&
        !panel.enabled &&
        externals.length > 0 &&
        externals.every((output) => output.enabled && !normalizedMirror(output.mirror))
    )
        return 'external-only';
    if (arranged.length < 2 || arranged.some((output) => !output.enabled)) return 'custom';

    const independent = arranged.filter((output) => !normalizedMirror(output.mirror));
    if (independent.length === 1) {
        const source = independent[0];
        if (
            arranged.every(
                (output) => output === source || normalizedMirror(output.mirror) === source.name
            )
        )
            return 'duplicate';
    }
    if (independent.length === arranged.length) return 'extend';
    return 'custom';
}

export function logicalMonitorSize(
    spec: MonitorSpec,
    output: OutputInfo
): {width: number; height: number} {
    const resolution = /^(\d+)x(\d+)/.exec(spec.resolution);
    let width = Number(resolution?.[1] ?? output.width);
    let height = Number(resolution?.[2] ?? output.height);
    const transform = Number.isFinite(spec.transform) ? ((spec.transform % 4) + 4) % 4 : 0;
    if (transform === 1 || transform === 3) [width, height] = [height, width];
    const scale = Number.isFinite(spec.scale) && spec.scale > 0 ? spec.scale : 1;
    return {width: width / scale, height: height / scale};
}

export function resolveAutoRightPositions(layout: Layout, outputs: OutputInfo[]): Layout {
    const outputsByName = new Map(outputs.map((output) => [output.name, output]));
    const positions = new Map<string, string>();
    let rightEdge = 0;
    const monitors = layout.monitors.map((monitor) => {
        if (monitor.disabled || monitor.mirror) return monitor;
        const output = outputsByName.get(monitor.name);
        if (!output) return monitor;
        const position = /^(-?\d+)x(-?\d+)$/.exec(monitor.position);
        const x = monitor.position === 'auto-right' ? rightEdge : Number(position?.[1] ?? output.x);
        const y = monitor.position === 'auto-right' ? 0 : Number(position?.[2] ?? output.y);
        const resolvedPosition = monitor.position === 'auto-right' ? `${x}x${y}` : monitor.position;
        positions.set(monitor.name, resolvedPosition);
        rightEdge = Math.max(rightEdge, x + logicalMonitorSize(monitor, output).width);
        return resolvedPosition === monitor.position
            ? monitor
            : {...monitor, position: resolvedPosition};
    });
    return {
        ...layout,
        monitors: monitors.map((monitor) => {
            if (monitor.disabled || !monitor.mirror) return monitor;
            const sourcePosition = positions.get(monitor.mirror);
            return sourcePosition && sourcePosition !== monitor.position
                ? {...monitor, position: sourcePosition}
                : monitor;
        }),
    };
}

export function setLayoutOutputEnabled(
    layout: Layout,
    name: string,
    enabled: boolean
): Layout | null {
    const current = layout.monitors.find((monitor) => monitor.name === name);
    if (!current) return null;
    const monitors = layout.monitors.map((monitor) => ({
        ...monitor,
        mirror: normalizedMirror(monitor.mirror),
    }));
    const target = monitors.find((monitor) => monitor.name === name);
    if (!target) return null;

    if (enabled) {
        target.disabled = false;
        if (target.mirror) {
            const source = monitors.find((monitor) => monitor.name === target.mirror);
            if (
                !source ||
                source.disabled ||
                source.name === target.name ||
                normalizedMirror(source.mirror)
            ) {
                target.mirror = null;
                target.position = 'auto-right';
            }
        }
    } else {
        const dependents = monitors
            .filter((monitor) => !monitor.disabled && monitor.mirror === target.name)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!target.disabled && !target.mirror && dependents.length) {
            const promoted = dependents[0];
            const oldPosition = target.position;
            promoted.mirror = null;
            promoted.position = oldPosition;
            for (const dependent of dependents.slice(1)) {
                dependent.mirror = promoted.name;
                dependent.position = oldPosition;
            }
        }
        target.disabled = true;
    }

    if (!validMirrorGraph(monitors)) return null;
    return {...layout, monitors};
}
