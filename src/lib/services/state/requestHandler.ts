import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import logger, {perf} from '#/lib/core/logger';

// ── CLI command routing table ──
// Maps command-line subcommands to GAction activations.
// Each service registers its own GActions via registerCommands().

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
    'record-window-address': (app, args) => {
        if (args[2] && app.lookup_action('record-window-address')) {
            app.activate_action(
                'record-window-address',
                new GLib.Variant('s', args[2])
            );
        }
    },
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