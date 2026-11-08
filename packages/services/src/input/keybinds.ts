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
    exec_cmd: 'Abrir aplicativos',
    exec_raw: 'Abrir aplicativos',
    show: 'Navegação entre espaços de trabalho',
    toggle_special: 'Navegação entre espaços de trabalho',
    swap_monitors: 'Navegação entre espaços de trabalho',
    change_id: 'Navegação entre espaços de trabalho',
    rename: 'Navegação entre espaços de trabalho',
    float: 'Controles de janela',
    fullscreen: 'Controles de janela',
    fullscreen_state: 'Controles de janela',
    close: 'Controles de janela',
    kill: 'Controles de janela',
    pseudo: 'Controles de janela',
    pin: 'Controles de janela',
    resize: 'Controles de janela',
    center: 'Controles de janela',
    drag: 'Controles de janela',
    focus: 'Navegação entre janelas',
    cycle_next: 'Navegação entre janelas',
    next: 'Navegação entre janelas',
    prev: 'Navegação entre janelas',
    active: 'Navegação entre janelas',
    layout: 'Layout',
    exit: 'Sistema',
    reload_config: 'Sistema',
    force_renderer_reload: 'Sistema',
    dpms: 'Sistema',
    force_idle: 'Sistema',
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

/** Group binds for presentation without modifying compositor-provided data. */
export function categorizeBinds(binds: readonly HyprBind[]): CategorizedBinds[] {
    const grouped = new Map<string, HyprBind[]>();

    for (const bind of binds) {
        const category = presentCategory(CATEGORY_MAP[dispatcherName(bind)] || 'Outros');
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category)!.push(bind);
    }

    return Array.from(grouped.entries())
        .map(([category, categorizedBinds]) => ({category, binds: categorizedBinds}))
        .sort((a, b) => a.category.localeCompare(b.category));
}

function dispatcherName(bind: HyprBind): string {
    return /^HL\.Dispatcher\(([^()]+)\)$/.exec(bind.dispatcher)?.[1] ?? '';
}

export const SHELL_ACTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
    'toggle-applauncher': 'Mostrar ou ocultar lançador de aplicativos',
    'toggle-quicksettings': 'Mostrar ou ocultar configurações rápidas',
    'toggle-bar': 'Mostrar ou ocultar barra',
    'toggle-windowswitcher': 'Mostrar ou ocultar alternador de janelas',
    'toggle-settings': 'Mostrar ou ocultar configurações',
    'toggle-clipboard': 'Mostrar ou ocultar gerenciador da área de transferência',
    'open-clipboard': 'Abrir gerenciador da área de transferência',
    lockscreen: 'Bloquear tela',
    'close-all': 'Fechar todos os painéis',
    screenshot: 'Capturar tela',
    'screenshot-area': 'Capturar área selecionada',
    'screenshot-overlay': 'Mostrar ou ocultar painel de captura de tela',
    record: 'Iniciar ou parar gravação',
    'record-area': 'Gravar área selecionada',
    'record-window': 'Gravar janela ativa',
    'record-output': 'Gravar monitor ativo',
    'record-window-address': 'Gravar janela selecionada',
    'display-next': 'Alternar layouts de monitores',
    'display-mode': 'Visualizar modo de exibição',
    'display-mode-chooser': 'Escolher modo de exibição',
    'display-toggle-internal': 'Ativar ou desativar monitor interno',
    'toggle-touchpad': 'Ativar ou desativar touchpad',
};

const DISPATCHER_DESCRIPTIONS: Readonly<Record<string, string>> = {
    show: 'Alternar espaço de trabalho',
    toggle_special: 'Mostrar ou ocultar espaço de trabalho especial',
    swap_monitors: 'Trocar monitores dos espaços de trabalho',
    change_id: 'Alterar ID do espaço de trabalho',
    rename: 'Renomear espaço de trabalho',
    float: 'Alternar modo flutuante',
    fullscreen: 'Alternar tela cheia',
    fullscreen_state: 'Alterar estado de tela cheia',
    focus: 'Focar janela',
    move: 'Mover janela',
    resize: 'Redimensionar janela',
    close: 'Fechar janela',
    kill: 'Forçar fechamento da janela',
    pseudo: 'Alternar modo pseudo-ladrilho',
    pin: 'Fixar janela',
    center: 'Centralizar janela',
    drag: 'Arrastar janela',
    cycle_next: 'Alternar foco entre janelas',
    next: 'Próxima janela do grupo',
    prev: 'Janela anterior do grupo',
    active: 'Alterar janela ativa do grupo',
    layout: 'Alterar layout',
    exit: 'Sair do Hyprland',
    reload_config: 'Recarregar configuração',
    force_renderer_reload: 'Recarregar renderizador',
    dpms: 'Alterar energia do monitor',
    force_idle: 'Forçar inatividade',
};

const CATEGORY_PRESENTATION: Readonly<Record<string, string>> = {
    'Launch Applications': 'Abrir aplicativos',
    'Window Controls': 'Controles de janela',
    'Window Navigation': 'Navegação entre janelas',
    'Workspace Navigation': 'Navegação entre espaços de trabalho',
    Layout: 'Layout',
    System: 'Sistema',
    Other: 'Outros',
};

const GENERIC_TITLE_PRESENTATION: Readonly<Record<string, string>> = {
    'Run command': 'Executar comando',
    'Custom shortcut': 'Atalho personalizado',
};

const TITLE_PRESENTATION: Readonly<Record<string, string>> = {
    ...GENERIC_TITLE_PRESENTATION,
    'Choose display mode': 'Escolher modo de exibição',
    'Toggle recording': 'Iniciar ou parar gravação',
    Move: 'Mover janela',
    'Move window into group on the left': 'Mover janela para o grupo à esquerda',
    'Move window into group on the right': 'Mover janela para o grupo à direita',
    'Move window into group above': 'Mover janela para o grupo acima',
    'Move window into group below': 'Mover janela para o grupo abaixo',
    'Move window out of group': 'Tirar janela do grupo',
    'Lock active group': 'Bloquear grupo ativo',
    'Zoom in': 'Aumentar zoom',
    'Zoom out': 'Diminuir zoom',
    'Reset zoom': 'Restaurar zoom',
};

const KEY_PRESENTATION: Readonly<Record<string, string>> = {
    mouse_up: 'Roda do mouse ↑',
    mouse_down: 'Roda do mouse ↓',
    'mouse:272': 'Botão esquerdo do mouse',
    'mouse:273': 'Botão direito do mouse',
    'mouse:274': 'Botão do meio do mouse',
};

function lookup(table: Readonly<Record<string, string>>, key: string): string | undefined {
    return globalThis.Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Translate a known English category label; unknown labels pass through unchanged. */
export function presentCategory(category: string): string {
    return lookup(CATEGORY_PRESENTATION, category) ?? category;
}

/** Translate raw compositor key names such as `mouse_up`; unknown keys pass through unchanged. */
export function presentKeyName(key: string): string {
    return lookup(KEY_PRESENTATION, key) ?? key;
}

/** Translate known titles; authored titles that are not recognised pass through verbatim. */
export function presentBindTitle(title: string): string {
    return lookup(TITLE_PRESENTATION, title) ?? title;
}

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
        this.#configPath = GLib.getenv('HYPRLAND_CONFIG') || '/etc/xdg/hypr/hyprland.lua';

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
        return categorizeBinds(this.#binds);
    }

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
            if (
                globalThis.Object.prototype.hasOwnProperty.call(SHELL_ACTION_DESCRIPTIONS, action)
            ) {
                return SHELL_ACTION_DESCRIPTIONS[action];
            }
            return dispatcher === 'exec_cmd' || dispatcher === 'exec_raw'
                ? 'Executar comando'
                : 'Atalho personalizado';
        }
        if (description) return description;

        // Never interpret or display opaque Lua dispatcher arguments.
        if (globalThis.Object.prototype.hasOwnProperty.call(DISPATCHER_DESCRIPTIONS, dispatcher)) {
            return DISPATCHER_DESCRIPTIONS[dispatcher];
        }
        return dispatcher === 'exec_cmd' || dispatcher === 'exec_raw'
            ? 'Executar comando'
            : 'Atalho personalizado';
    }

    /** Row title: the description translated to pt-BR when recognised. */
    formatTitle(bind: HyprBind): string {
        return presentBindTitle(this.formatDescription(bind));
    }

    #formatKey(rawKey: string): string {
        const key = presentKeyName(rawKey);
        if (key !== rawKey) return key;
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
