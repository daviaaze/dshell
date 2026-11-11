import {Process} from '@shade/core/process';
import {
    planBindingDiff,
    renderBindLua,
    renderConfigOptionLua,
    renderDpmsLua,
    renderKeystrokeOverlaySubscriptionLua,
    renderMonitorLua,
    renderWorkspaceRuleLua,
    type BindSpec,
    type LuaValue,
    type MonitorProfile,
} from '@shade/compositor-model';
export interface CompositorTransport {
    dispatch(source: string): Promise<void>;
    eval?(source: string): Promise<void>;
    request?(argv: string[]): Promise<string>;
}

const hyprlandTransport: CompositorTransport = {
    async dispatch(source) {
        await Process.execAsyncv(['hyprctl', 'dispatch', `function() ${source} end`], true);
    },
    async eval(source) {
        await Process.execAsyncv(['hyprctl', 'eval', source], true);
    },
    async request(argv) {
        return Process.execAsyncv(['hyprctl', ...argv]);
    },
};

export interface HyprlandDisplaySnapshot {
    all: unknown[];
    active: unknown[];
    workspaces: unknown[];
}

export interface HyprlandKeyboard {
    name: string;
    active_keymap: string;
}

export interface HyprlandDevices {
    keyboards: HyprlandKeyboard[];
}

/** Typed Hyprland boundary for compositor state and mutations. */
export class CompositorPort {
    constructor(private readonly transport: CompositorTransport = hyprlandTransport) {}

    async applyBinds(previous: readonly BindSpec[], next: readonly BindSpec[]): Promise<void> {
        for (const operation of planBindingDiff(previous, next)) {
            const source =
                operation.type === 'unbind'
                    ? `hl.unbind(${JSON.stringify(operation.keys)})`
                    : renderBindLua(operation.bind);
            await this.transport.dispatch(source);
        }
    }

    async applyMonitor(monitor: MonitorProfile['monitors'][number]): Promise<void> {
        await this.#eval(renderMonitorLua(monitor));
    }

    async applyWorkspaceRule(workspace: string, monitor: string): Promise<void> {
        await this.#eval(renderWorkspaceRuleLua(workspace, monitor));
    }

    async applyDpms(on: boolean, monitor?: string): Promise<void> {
        await this.#eval(renderDpmsLua(on, monitor));
    }

    async setKeystrokeOverlay(enabled: boolean): Promise<void> {
        await this.#eval(renderKeystrokeOverlaySubscriptionLua(enabled));
    }
    displaySnapshot(): Promise<HyprlandDisplaySnapshot> {
        return Promise.all([
            this.#request(['monitors', 'all', '-j']),
            this.#request(['monitors', '-j']),
            this.#request(['workspaces', '-j']),
        ]).then(([all, active, workspaces]) => ({
            all: JSON.parse(all) as unknown[],
            active: JSON.parse(active) as unknown[],
            workspaces: JSON.parse(workspaces) as unknown[],
        }));
    }

    async clientSnapshot(): Promise<unknown[]> {
        return JSON.parse(await this.#request(['clients', '-j'])) as unknown[];
    }

    async deviceSnapshot(): Promise<HyprlandDevices> {
        const devices: unknown = JSON.parse(await this.#request(['devices', '-j']));
        if (typeof devices !== 'object' || devices === null || Array.isArray(devices))
            throw new Error('Invalid Hyprland device snapshot');
        if (!('keyboards' in devices) || !Array.isArray(devices.keyboards))
            throw new Error('Invalid Hyprland keyboard snapshot');
        return {
            keyboards: devices.keyboards.filter(
                (keyboard): keyboard is HyprlandKeyboard =>
                    typeof keyboard === 'object' &&
                    keyboard !== null &&
                    !Array.isArray(keyboard) &&
                    'name' in keyboard &&
                    typeof keyboard.name === 'string' &&
                    'active_keymap' in keyboard &&
                    typeof keyboard.active_keymap === 'string'
            ),
        };
    }

    clientSnapshotSync(): unknown[] {
        return JSON.parse(Process.exec('hyprctl clients -j')) as unknown[];
    }

    async switchKeyboardLayout(name: string): Promise<void> {
        await this.#request(['switchxkblayout', name, 'next']);
    }

    async createHeadlessOutput(name: string): Promise<void> {
        await this.#request(['output', 'create', 'headless', name]);
    }

    async removeOutput(name: string): Promise<void> {
        await this.#request(['output', 'remove', name]);
    }

    getOptionSync(key: string, fallback: string): string {
        try {
            const match = Process.exec(`hyprctl getoption ${key}`).match(
                /(?:int|float|string):\s*(\S+)/
            );
            return match?.[1] ?? fallback;
        } catch {
            return fallback;
        }
    }

    async setConfigOption(path: string, value: LuaValue): Promise<void> {
        await this.#eval(renderConfigOptionLua(path, value));
    }

    async #request(argv: string[]): Promise<string> {
        if (this.transport.request) return this.transport.request(argv);
        return Process.execAsyncv(['hyprctl', ...argv]);
    }

    async #eval(source: string): Promise<void> {
        if (this.transport.eval) await this.transport.eval(source);
        else await this.transport.dispatch(source);
    }
}
