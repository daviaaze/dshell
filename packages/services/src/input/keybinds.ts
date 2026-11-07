import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register} from 'gnim/gobject';

export interface HyprBind {
    key: string;
    modmask: number;
    dispatcher: string;
    arg: string;
    locked: boolean;
    mouse: boolean;
    release: boolean;
    repeat: boolean;
    nonmodal: boolean;
    has_description: boolean;
    description?: string;
}


export interface CategorizedBinds {
    category: string;
    binds: HyprBind[];
}

// Dispatcher names are factory names, not qualified Lua paths.
const CATEGORY_MAP: Readonly<Record<string, string>> = {
    exec_cmd: 'Launch Applications',
    exec_raw: 'Launch Applications',
    show: 'Workspace Navigation',
    toggle_special: 'Workspace Navigation',
    swap_monitors: 'Workspace Navigation',
    change_id: 'Workspace Navigation',
    rename: 'Workspace Navigation',
    float: 'Window Controls',
    fullscreen: 'Window Controls',
    fullscreen_state: 'Window Controls',
    close: 'Window Controls',
    kill: 'Window Controls',
    pseudo: 'Window Controls',
    pin: 'Window Controls',
    resize: 'Window Controls',
    center: 'Window Controls',
    drag: 'Window Controls',
    focus: 'Window Navigation',
    cycle_next: 'Window Navigation',
    next: 'Window Navigation',
    prev: 'Window Navigation',
    active: 'Window Navigation',
    layout: 'Layout',
    exit: 'System',
    reload_config: 'System',
    force_renderer_reload: 'System',
    dpms: 'System',
    force_idle: 'System',
};

const MODIFIERS: ReadonlyArray<readonly [number, string]> = [
    [64, 'Super'],
    [4, 'Ctrl'],
    [8, 'Alt'],
    [1, 'Shift'],
    [2, 'Caps Lock'],
    [16, 'Mod2'],
    [32, 'Mod3'],
    [128, 'Mod5'],
];

function dispatcherName(bind: HyprBind): string {
    return /^HL\.Dispatcher\(([^()]+)\)$/.exec(bind.dispatcher)?.[1] ?? '';
}

export const SHELL_ACTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
    'toggle-applauncher': 'Toggle app launcher',
    'toggle-quicksettings': 'Toggle quick settings',
    'toggle-bar': 'Show or hide bar',
    'toggle-windowswitcher': 'Toggle window switcher',
    'toggle-settings': 'Toggle settings',
    'toggle-clipboard': 'Toggle clipboard manager',
    'open-clipboard': 'Open clipboard manager',
    lockscreen: 'Lock screen',
    'close-all': 'Close all popups',
    screenshot: 'Take screenshot',
    'screenshot-area': 'Screenshot selected area',
    'screenshot-overlay': 'Toggle screenshot overlay',
    record: 'Toggle recording',
    'record-area': 'Record selected area',
    'record-window': 'Record active window',
    'record-output': 'Record active output',
    'record-window-address': 'Record selected window',
    'display-next': 'Cycle display layouts',
    'display-mode': 'Preview display mode',
    'display-mode-chooser': 'Choose display mode',
    'display-toggle-internal': 'Toggle internal display',
    'toggle-touchpad': 'Toggle touchpad',
};

const DISPATCHER_DESCRIPTIONS: Readonly<Record<string, string>> = {
    show: 'Switch workspace',
    toggle_special: 'Toggle special workspace',
    swap_monitors: 'Swap workspace monitors',
    change_id: 'Change workspace ID',
    rename: 'Rename workspace',
    float: 'Toggle floating mode',
    fullscreen: 'Toggle fullscreen',
    fullscreen_state: 'Change fullscreen state',
    focus: 'Focus window',
    move: 'Move',
    resize: 'Resize window',
    close: 'Close window',
    kill: 'Kill window',
    pseudo: 'Toggle pseudo-tile mode',
    pin: 'Pin window',
    center: 'Center window',
    drag: 'Drag window',
    cycle_next: 'Cycle window focus',
    next: 'Next group window',
    prev: 'Previous group window',
    active: 'Change active group window',
    layout: 'Change layout',
    exit: 'Exit Hyprland',
    reload_config: 'Reload configuration',
    force_renderer_reload: 'Reload the renderer',
    dpms: 'Change display power',
    force_idle: 'Force idle',
};

@register
export default class Keybinds extends Object {
    private static instance: Keybinds;

    static get_default(): Keybinds {
        if (!Keybinds.instance) Keybinds.instance = Keybinds.create();
        return Keybinds.instance;
    }

    static create(): Keybinds {
        const instance = new Keybinds();
        instance.#init();
        return instance;
    }

    #binds: HyprBind[] = [];
    #configPath = '';

    @property
    get binds(): HyprBind[] {
        return this.#binds;
    }

    @property
    get configPath(): string {
        return this.#configPath;
    }

    #init(): void {
        this.#configPath =
            GLib.getenv('HYPRLAND_CONFIG') || '/etc/xdg/hypr/hyprland.lua';

        this.refresh();
    }

    /** Refresh keybinds from Hyprland. */
    refresh(): void {
        Process.execAsync('hyprctl binds -j')
            .then((out) => {
                this.#binds = JSON.parse(out) as HyprBind[];
                this.notify('binds');
            })
            .catch((e) => {
                logger.error('keybinds', 'Failed to fetch binds:', e);
                this.#binds = [];
                this.notify('binds');
            });
    }

    /** Get keybinds grouped by category. */
    getCategorizedBinds(): CategorizedBinds[] {
        const grouped = new Map<string, HyprBind[]>();

        for (const bind of this.#binds) {
            const category = CATEGORY_MAP[dispatcherName(bind)] || 'Other';
            if (!grouped.has(category)) {
                grouped.set(category, []);
            }
            grouped.get(category)!.push(bind);
        }

        return Array.from(grouped.entries())
            .map(([category, binds]) => ({category, binds}))
            .sort((a, b) => a.category.localeCompare(b.category));
    }

    /** Format key combo for display. */
    formatKeyCombo(bind: HyprBind): string {
        const parts: string[] = [];
        for (const [mask, label] of MODIFIERS) {
            if (bind.modmask & mask) parts.push(label);
        }
        if (bind.key) {
            parts.push(this.#formatKey(bind.key));
        }
        return parts.join(' + ');
    }

    /** Describe metadata or compositor behavior without interpreting command text. */
    formatDescription(bind: HyprBind): string {
        const dispatcher = dispatcherName(bind);
        const description = bind.description;
        if (description?.startsWith('shade-action:')) {
            const action = description.slice('shade-action:'.length);
            if (Object.prototype.hasOwnProperty.call(SHELL_ACTION_DESCRIPTIONS, action)) {
                return SHELL_ACTION_DESCRIPTIONS[action];
            }
            return dispatcher === 'exec_cmd' || dispatcher === 'exec_raw'
                ? 'Run command'
                : 'Custom shortcut';
        }
        if (description) return description;

        // Lua bind arguments are opaque dispatcher tokens, never command text.
        if (Object.prototype.hasOwnProperty.call(DISPATCHER_DESCRIPTIONS, dispatcher)) {
            return DISPATCHER_DESCRIPTIONS[dispatcher];
        }
        return dispatcher === 'exec_cmd' || dispatcher === 'exec_raw'
            ? 'Run command'
            : 'Custom shortcut';
    }


    #formatKey(key: string): string {
        const keyMap: Record<string, string> = {
            RETURN: 'Enter',
            SPACE: 'Space',
            TAB: 'Tab',
            ESCAPE: 'Esc',
            BACKSPACE: 'Backspace',
            DELETE: 'Delete',
            UP: 'Up',
            DOWN: 'Down',
            LEFT: 'Left',
            RIGHT: 'Right',
            HOME: 'Home',
            END: 'End',
            PAGE_UP: 'PgUp',
            PAGE_DOWN: 'PgDn',
        };
        const upper = key.toUpperCase();
        if (keyMap[upper]) return keyMap[upper];
        if (key.startsWith('code:')) return key.substring(5);
        return key.length === 1 ? key.toUpperCase() : key;
    }

    /** Open Hyprland config in default editor. */
    openConfig(): void {
        const editor = GLib.getenv('EDITOR') || 'xdg-open';
        Process.execAsync(`${editor} "${this.#configPath}"`).catch((e) => {
            logger.error('keybinds', 'Failed to open config:', e);
        });
    }
}

defineService({name: 'Keybinds', service: Keybinds.get_default()});
