import GLib from 'gi://GLib?version=2.0';
import {defineService} from '@shade/core/define';
import logger from '@shade/core/logger';
import {Process} from '@shade/core/process';
import {Object, property, register} from 'gnim/gobject';

export interface HyprBind {
    key: string;
    mod: string;
    dispatcher: string;
    arg: string;
    locked: boolean;
    mouse: boolean;
    release: boolean;
    repeat: boolean;
    nonmodal: boolean;
    hasDescription: boolean;
}

export interface ShellAction {
    name: string;
    description: string;
}

export interface CategorizedBinds {
    category: string;
    binds: HyprBind[];
}

const CATEGORY_MAP: Record<string, string> = {
    exec: 'Launch Applications',
    workspace: 'Workspace Navigation',
    movetoworkspace: 'Workspace Navigation',
    movetoworkspacesilent: 'Workspace Navigation',
    togglefloating: 'Window Controls',
    fullscreen: 'Window Controls',
    focuswindow: 'Window Controls',
    movewindow: 'Window Controls',
    resizewindow: 'Window Controls',
    killactive: 'Window Controls',
    togglepseudo: 'Window Controls',
    pin: 'Window Controls',
    cyclenext: 'Window Navigation',
    changegroupactive: 'Window Navigation',
    splitratio: 'Layout',
    togglesplit: 'Layout',
    layoutopt: 'Layout',
    swapnext: 'Window Navigation',
    swapactiveworkspaces: 'Workspace Navigation',
    exit: 'System',
    forcerendererreload: 'System',
    execr: 'System',
};

const SHELL_ACTION_DESCRIPTIONS: Record<string, string> = {
    'toggle-applauncher': 'Toggle app launcher',
    'toggle-quicksettings': 'Toggle quick settings',
    'toggle-bar': 'Toggle top bar',
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
    'toggle-touchpad': 'Toggle touchpad',
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
    #shellActions: ShellAction[] = [];
    #configPath = '';

    @property
    get binds(): HyprBind[] {
        return this.#binds;
    }

    @property
    get shellActions(): ShellAction[] {
        return this.#shellActions;
    }

    @property
    get configPath(): string {
        return this.#configPath;
    }

    #init(): void {
        // Determine Hyprland config path
        const xdgConfig = GLib.getenv('XDG_CONFIG_HOME');
        const home = GLib.get_home_dir();
        const configDir = xdgConfig || `${home}/.config`;
        this.#configPath = `${configDir}/hypr/hyprland.conf`;

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

    /** Set shell GActions (called from app bootstrap). */
    setShellActions(actions: ShellAction[]): void {
        this.#shellActions = actions;
        this.notify('shellActions');
    }

    /** Get keybinds grouped by category. */
    getCategorizedBinds(): CategorizedBinds[] {
        const grouped = new Map<string, HyprBind[]>();

        for (const bind of this.#binds) {
            const category = CATEGORY_MAP[bind.dispatcher] || 'Other';
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
        if (bind.mod) {
            const mods = bind.mod
                .split(',')
                .map((m) => m.trim())
                .filter(Boolean);
            parts.push(...mods.map(this.#formatMod));
        }
        if (bind.key) {
            parts.push(this.#formatKey(bind.key));
        }
        return parts.join(' + ');
    }

    /** Format bind description. */
    formatDescription(bind: HyprBind): string {
        if (bind.arg) {
            return `${bind.dispatcher}: ${bind.arg}`;
        }
        return bind.dispatcher;
    }

    #formatMod(mod: string): string {
        const modMap: Record<string, string> = {
            SUPER: 'Super',
            CTRL: 'Ctrl',
            ALT: 'Alt',
            SHIFT: 'Shift',
            MOD4: 'Super',
            MOD1: 'Alt',
        };
        return modMap[mod.toUpperCase()] || mod;
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
