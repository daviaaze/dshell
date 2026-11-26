/**
 * Pure routing table for the `shade-shell` CLI: subcommand name plus its
 * positional arguments → what the running shell must do.
 *
 * No GI imports, so the tests exercise the same table the dispatcher uses.
 */

/** Widget names accepted by `toggle`, mapped to the GAction each one activates. */
export const TOGGLE_ACTIONS: Record<string, string> = {
    launcher: 'toggle-applauncher',
    applauncher: 'toggle-applauncher',
    quicksettings: 'toggle-quicksettings',
    notifications: 'toggle-notifications',
    settings: 'toggle-settings',
    bar: 'toggle-bar',
    windowswitcher: 'toggle-windowswitcher',
    clipboard: 'toggle-clipboard',
    touchpad: 'toggle-touchpad',
};

/** Subcommands that activate one GAction without arguments. */
const PLAIN_ACTIONS: Record<string, string> = {
    screenshot: 'screenshot',
    'screenshot-area': 'screenshot-area',
    'screenshot-overlay': 'screenshot-overlay',
    record: 'record',
    'record-area': 'record-area',
    'record-window': 'record-window',
    'record-output': 'record-output',
    lockscreen: 'lockscreen',
    clipboard: 'toggle-clipboard',
    'open-clipboard': 'open-clipboard',
    'display-next': 'display-next',
    'display-mode-chooser': 'display-mode-chooser',
    'display-toggle-internal': 'display-toggle-internal',
    touchpad: 'toggle-touchpad',
};

/** Subcommands that activate a GAction with one required string argument, by argument name. */
const STRING_ACTIONS: Record<string, string> = {
    'record-window-address': 'ADDRESS',
    'display-mode': 'MODE',
};

export type CliRoute =
    /** Activate a GAction, with `value` as its string parameter when present. */
    | {kind: 'action'; action: string; value?: string}
    /** Toggle Do Not Disturb through the event bus. */
    | {kind: 'dnd-toggle'}
    /** The subcommand exists but was called wrongly. */
    | {kind: 'usage'; message: string};

/** Own-property lookup: user-typed names like `constructor` must not hit Object.prototype. */
function lookup(table: Record<string, string>, key: string): string | undefined {
    return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Resolve a parsed subcommand. Returns `null` when the subcommand is unknown. */
export function resolveRoute(name: string | null, args: readonly string[]): CliRoute | null {
    if (name === null) return null;

    if (name === 'toggle') {
        const widget = args[0];
        if (!widget) return {kind: 'usage', message: 'toggle: missing WIDGET'};
        const action = lookup(TOGGLE_ACTIONS, widget);
        if (!action) return {kind: 'usage', message: `toggle: unknown widget '${widget}'`};
        return {kind: 'action', action};
    }

    if (name === 'toggle-dnd') return {kind: 'dnd-toggle'};

    const plain = lookup(PLAIN_ACTIONS, name);
    if (plain) return {kind: 'action', action: plain};

    const argName = lookup(STRING_ACTIONS, name);
    if (argName) {
        const value = args[0];
        if (!value) return {kind: 'usage', message: `${name}: missing ${argName}`};
        return {kind: 'action', action: name, value};
    }

    return null;
}
