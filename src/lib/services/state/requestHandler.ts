/**
 * CLI command routing using Quarrel — structured argument parsing with
 * auto-generated help and subcommand validation.
 *
 * Each desktop service registers its own GActions via registerCommands().
 * This file parses CLI args and routes them to those GActions.
 */
import Quarrel from 'gi://Quarrel';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {programInvocationName, programArgs, exit} from 'system';
import {bus} from '#/lib/core/eventBus';
import logger, {perf} from '#/lib/core/logger';

// ── Help flag (shared) ──

const help = Quarrel.Flag.new('help', 'h'.charCodeAt(0), 'Print this help');

// ── Action lookup helper ──

function activate(app: Gio.Application, actionName: string): void {
    if (app.lookup_action(actionName)) {
        app.activate_action(actionName, null);
    } else {
        logger.warn('dbus', `unknown action: ${actionName}`);
    }
}

function activateWithString(
    app: Gio.Application,
    actionName: string,
    value: string
): void {
    if (app.lookup_action(actionName)) {
        app.activate_action(actionName, new GLib.Variant('s', value));
    } else {
        logger.warn('dbus', `unknown action: ${actionName}`);
    }
}

// ── Build command tree ──

function buildCLI(app: Gio.Application): Quarrel.Command {
    // Subcommands
    const toggle = new Quarrel.Command('toggle')
        .about('Toggle a widget visibility')
        .arg('WIDGET', 'Widget to toggle: launcher, quicksettings, settings, bar, windowswitcher, touchpad')
        .opt(help);

    const screenshot = new Quarrel.Command('screenshot')
        .about('Take a fullscreen screenshot')
        .opt(help);

    const screenshotArea = new Quarrel.Command('screenshot-area')
        .about('Take a screensho of a selected area')
        .opt(help);

    const screenshotOverlay = new Quarrel.Command('screenshot-overlay')
        .about('Open the screenshot/recording overlay UI')
        .opt(help);

    const record = new Quarrel.Command('record')
        .about('Start recording fullscreen')
        .opt(help);

    const recordArea = new Quarrel.Command('record-area')
        .about('Record a selected area')
        .opt(help);

    const recordWindow = new Quarrel.Command('record-window')
        .about('Record the focused window')
        .opt(help);

    const recordWindowAddr = new Quarrel.Command('record-window-address')
        .about('Record a window by its Hyprland address')
        .arg('ADDRESS', 'Hyprland window address (e.g. 0x12345678)')
        .opt(help);

    const recordOutput = new Quarrel.Command('record-output')
        .about('Record the focused monitor output')
        .opt(help);

    const lockscreen = new Quarrel.Command('lockscreen')
        .about('Lock the screen')
        .opt(help);

    const clipboard = new Quarrel.Command('clipboard')
        .about('Open launcher in clipboard mode')
        .opt(help);

    const openClipboard = new Quarrel.Command('open-clipboard')
        .about('Open clipboard history directly')
        .opt(help);

    const toggleDnd = new Quarrel.Command('toggle-dnd')
        .about('Toggle Do Not Disturb mode')
        .opt(help);

    const touchpad = new Quarrel.Command('touchpad')
        .about('Toggle touchpad enable/disable')
        .opt(help);

    // Root CLI
    const cli = new Quarrel.Command('shade-shell')
        .about('Shade Shell — Hyprland Adwaita Desktop Environment')
        .subcommand(toggle)
        .subcommand(screenshot)
        .subcommand(screenshotArea)
        .subcommand(screenshotOverlay)
        .subcommand(record)
        .subcommand(recordArea)
        .subcommand(recordWindow)
        .subcommand(recordWindowAddr)
        .subcommand(recordOutput)
        .subcommand(lockscreen)
        .subcommand(clipboard)
        .subcommand(openClipboard)
        .subcommand(toggleDnd)
        .subcommand(touchpad)
        .opt(help);

    return cli;
}

// ── Dispatch ──

function dispatch(
    command: Quarrel.Command,
    app: Gio.Application
): boolean {
    const name = command.get_name();

    switch (name) {
        case 'toggle':
            if (help.value || command.get_args().length === 0) {
                return false; // caller will print help
            }
            activate(app, `toggle-${command.get_args()[0]}`);
            return true;

        case 'screenshot':
            activate(app, 'screenshot');
            return true;

        case 'screenshot-area':
            activate(app, 'screenshot-area');
            return true;

        case 'screenshot-overlay':
            activate(app, 'screenshot-overlay');
            return true;

        case 'record':
            activate(app, 'record');
            return true;

        case 'record-area':
            activate(app, 'record-area');
            return true;

        case 'record-window':
            activate(app, 'record-window');
            return true;

        case 'record-window-address': {
            const addr = command.get_args()[0];
            if (addr) {
                activateWithString(app, 'record-window-address', addr);
            }
            return true;
        }

        case 'record-output':
            activate(app, 'record-output');
            return true;

        case 'lockscreen':
            activate(app, 'lockscreen');
            return true;

        case 'clipboard':
            activate(app, 'toggle-clipboard');
            return true;

        case 'open-clipboard':
            activate(app, 'open-clipboard');
            return true;

        case 'toggle-dnd':
            bus.emit('system:dnd:toggle');
            return true;

        case 'touchpad':
            activate(app, 'toggle-touchpad');
            return true;

        default:
            return false;
    }
}

// ── Entry point ──

export const requestHandler = (
    cmd: Gio.ApplicationCommandLine,
    app: Gio.Application
) => {
    const cli = buildCLI(app);
    const args = cmd.get_arguments();

    logger.debug('dbus', `requestHandler args=${args.slice(1).join(' ')}`);

    // Parse: args[0] is usually the program name, args[1] is the subcommand
    const argList = [programInvocationName, ...args.slice(1)];
    const matched = cli.parse(argList);

    if (matched === cli && help.value) {
        print(Quarrel.help(cli));
        cmd.done();
        return;
    }

    if (matched) {
        const cmdName = matched.get_name();
        perf.measureSync(
            `dbus-${cmdName}`,
            () => {
                const ok = dispatch(matched, app);
                if (!ok) {
                    print(Quarrel.help(matched));
                }
            },
            'dbus'
        );
    } else {
        logger.warn('dbus', `no command matched, args=${argList.slice(1).join(' ')}`);
        print(Quarrel.help(cli));
    }

    logger.debug('dbus', 'requestHandler done');
    cmd.done();
};