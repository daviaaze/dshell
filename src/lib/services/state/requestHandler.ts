import ShellState from '#/lib/shellState';
import WindowManager from '#/lib/windowManager';
import Screenshot from '#/lib/screenshot';
import Touchpad from '#/lib/touchpad';
import {openSettings} from '#/widget';
import {toggleWindowSwitcher} from '#/widget/windowswitcher';
import Gio from 'gi://Gio?version=2.0';
import logger, {perf} from '#/lib/logger';

// ── Action definitions ──
// Each entry maps a GAction name to its handler. Handlers receive the app instance
// for actions that need it (e.g. toggling bar visibility).

function buildActions(app: Gio.Application): Record<string, () => void> {
    const state = ShellState.get_default();
    const wm = WindowManager.get_default();
    const screenshot = Screenshot.get_default();
    const touchpad = Touchpad.get_default();

    return {
        'toggle-applauncher': () => state.toggleLauncher(),
        'toggle-quicksettings': () => state.toggleQuickSettings(),
        'toggle-bar': () =>
            wm.bars.forEach(bar => (bar.visible = !bar.visible)),
        'toggle-windowswitcher': () => toggleWindowSwitcher(),
        'toggle-settings': () => openSettings(),
        'toggle-clipboard': () => state.toggleClipboard(),
        'open-clipboard': () => state.openClipboard(),
        lockscreen: () => {
            state.screenlocked = true;
        },
        screenshot: () => screenshot.screenshot(true),
        'screenshot-area': () => screenshot.screenshot(false),
        'screenshot-overlay': () => screenshot.toggleOverlay(),
        record: () => screenshot.toggleRecording(),
        'record-area': () => screenshot.recordArea(),
        'record-window': () => screenshot.recordWindow(),
        'record-output': () => screenshot.recordOutput(),
        'toggle-touchpad': () => touchpad.toggle(),
    };
}

// ── Register GActions on the application ──

export function registerActions(app: Gio.Application) {
    for (const [name, fn] of Object.entries(buildActions(app))) {
        const action = Gio.SimpleAction.new(name, null);
        action.connect('activate', fn);
        app.add_action(action);
    }
}

// ── CLI command routing table ──
// Maps command-line subcommands to action names and parameter handling.
// For commands that need extra args (e.g. record-window-address), use a handler
// function instead of a simple action name.

type CommandHandler = (app: Gio.Application, args: string[]) => void;

const actionCommand = (actionName: string): CommandHandler => {
    return (app, _args) => {
        if (app.lookup_action(actionName)) {
            app.activate_action(actionName, null);
        } else {
            logger.warn('dbus', `unknown action: ${actionName}`);
        }
    };
};

const commandRoutes: Record<string, CommandHandler> = {
    lockscreen: actionCommand('lockscreen'),
    clipboard: actionCommand('toggle-clipboard'),
    screenshot: actionCommand('screenshot'),
    'screenshot-area': actionCommand('screenshot-area'),
    'screenshot-overlay': actionCommand('screenshot-overlay'),
    record: actionCommand('record'),
    'record-area': actionCommand('record-area'),
    'record-window': actionCommand('record-window'),
    'record-output': actionCommand('record-output'),
    touchpad: actionCommand('toggle-touchpad'),
    toggle: (app, args) => {
        const target = args[2];
        if (target) {
            actionCommand(`toggle-${target}`)(app, args);
        } else {
            logger.warn('dbus', 'toggle requires a target (e.g. toggle bar)');
        }
    },
    'record-window-address': (app, args) => {
        if (args[2]) Screenshot.get_default().recordWindowByAddress(args[2]);
    },
};

// ── Request dispatcher ──

export const requestHandler = (
    cmd: Gio.ApplicationCommandLine,
    app: Gio.Application
) => {
    const args = cmd.get_arguments();
    logger.debug('dbus', `requestHandler args=${args.slice(1).join(' ')}`);

    const command = args[1];
    if (!command) {
        logger.warn('dbus', 'no command provided');
        cmd.done();
        return;
    }
    const handler = commandRoutes[command];

    if (handler) {
        perf.measureSync(`dbus-${command}`, () => handler(app, args), 'dbus');
    } else {
        logger.warn('dbus', `unknown command: ${command}`);
    }

    logger.debug('dbus', 'requestHandler done');
    cmd.done();
};
