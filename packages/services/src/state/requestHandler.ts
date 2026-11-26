/**
 * CLI command routing using Quarrel — structured argument parsing with
 * auto-generated help and subcommand validation.
 *
 * Each desktop service registers its own GActions via registerCommands().
 * This file parses CLI args and routes them to those GActions; the routing
 * table itself lives in cliRoutes.ts.
 */

import type Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Quarrel from 'gi://Quarrel';
import logger, {perf} from '@shade/core/logger';
import {bus} from '../bus';
import {resolveRoute, TOGGLE_ACTIONS} from './cliRoutes';

/** Exit statuses reported to the calling `shade-shell` process. */
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

// CLI subcommand names (shared by declaration and dispatch)
const CMD_SCREENSHOT_AREA = 'screenshot-area';
const CMD_SCREENSHOT_OVERLAY = 'screenshot-overlay';
const CMD_RECORD_AREA = 'record-area';
const CMD_RECORD_WINDOW = 'record-window';
const CMD_RECORD_WINDOW_ADDRESS = 'record-window-address';
const CMD_RECORD_OUTPUT = 'record-output';
const CMD_OPEN_CLIPBOARD = 'open-clipboard';
const CMD_DISPLAY_NEXT = 'display-next';
const CMD_DISPLAY_MODE = 'display-mode';
const CMD_DISPLAY_MODE_CHOOSER = 'display-mode-chooser';
const CMD_DISPLAY_TOGGLE_INTERNAL = 'display-toggle-internal';

// ── Build command tree ──

/**
 * The help flag is created per request: Quarrel stores the parsed state on the
 * flag object, so a shared one would stay enabled after the first `--help`.
 */
function buildCLI(): {cli: Quarrel.Command; help: Quarrel.SpecialFlag} {
    const help = Quarrel.SpecialFlag.new('help', 'h'.charCodeAt(0), 'Print this help');

    // Subcommands
    const toggle = new Quarrel.Command({name: 'toggle'})
        .about('Toggle a widget visibility')
        .arg('WIDGET', `Widget to toggle: ${Object.keys(TOGGLE_ACTIONS).join(', ')}`)
        .opt(help);

    const screenshot = new Quarrel.Command({name: 'screenshot'})
        .about('Take a fullscreen screenshot')
        .opt(help);

    const screenshotArea = new Quarrel.Command({name: CMD_SCREENSHOT_AREA})
        .about('Take a screenshot of a selected area')
        .opt(help);

    const screenshotOverlay = new Quarrel.Command({name: CMD_SCREENSHOT_OVERLAY})
        .about('Open the screenshot/recording overlay UI')
        .opt(help);

    const record = new Quarrel.Command({name: 'record'})
        .about('Start recording fullscreen')
        .opt(help);

    const recordArea = new Quarrel.Command({name: CMD_RECORD_AREA})
        .about('Record a selected area')
        .opt(help);

    const recordWindow = new Quarrel.Command({name: CMD_RECORD_WINDOW})
        .about('Record the focused window')
        .opt(help);

    const recordWindowAddr = new Quarrel.Command({
        name: CMD_RECORD_WINDOW_ADDRESS,
    })
        .about('Record a window by its Hyprland address')
        .arg('ADDRESS', 'Hyprland window address (e.g. 0x12345678)')
        .opt(help);

    const recordOutput = new Quarrel.Command({name: CMD_RECORD_OUTPUT})
        .about('Record the focused monitor output')
        .opt(help);

    const lockscreen = new Quarrel.Command({name: 'lockscreen'}).about('Lock the screen').opt(help);

    const clipboard = new Quarrel.Command({name: 'clipboard'})
        .about('Open launcher in clipboard mode')
        .opt(help);

    const openClipboard = new Quarrel.Command({name: CMD_OPEN_CLIPBOARD})
        .about('Open clipboard history directly')
        .opt(help);

    const toggleDnd = new Quarrel.Command({name: 'toggle-dnd'})
        .about('Toggle Do Not Disturb mode')
        .opt(help);

    const touchpad = new Quarrel.Command({name: 'touchpad'})
        .about('Toggle touchpad enable/disable')
        .opt(help);

    const displayNext = new Quarrel.Command({name: CMD_DISPLAY_NEXT})
        .about('Preview the next layout matching connected displays')
        .opt(help);
    const displayMode = new Quarrel.Command({name: CMD_DISPLAY_MODE})
        .about('Preview a built-in display mode')
        .arg('MODE', 'Display mode: internal-only, external-only, extend, duplicate')
        .opt(help);

    const displayModeChooser = new Quarrel.Command({name: CMD_DISPLAY_MODE_CHOOSER})
        .about('Open the display mode chooser')
        .opt(help);

    const displayToggleInternal = new Quarrel.Command({name: CMD_DISPLAY_TOGGLE_INTERNAL})
        .about('Toggle the internal display')
        .opt(help);

    // Root CLI
    const cli = new Quarrel.Command({name: 'shade-shell'})
        .about('Shade Shell — Hyprland Adwaita Desktop Environment')
        .opt(help)
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
        .subcommand(displayMode)
        .subcommand(displayModeChooser)
        .subcommand(displayToggleInternal)
        .subcommand(displayNext)
        .subcommand(touchpad);

    return {cli, help};
}

// ── Dispatch ──

/** Write to the stdout/stderr of the process that sent the request. */
function reply(cmd: Gio.ApplicationCommandLine, text: string, stderr = false): void {
    const line = text.endsWith('\n') ? text : `${text}\n`;
    if (stderr) cmd.printerr_literal(line);
    else cmd.print_literal(line);
}

function dispatch(
    command: Quarrel.Command,
    cmd: Gio.ApplicationCommandLine,
    app: Gio.Application
): number {
    const route = resolveRoute(command.get_name(), command.get_args());

    if (!route || route.kind === 'usage') {
        if (route) reply(cmd, `shade-shell ${route.message}`, true);
        reply(cmd, Quarrel.help(command), true);
        return EXIT_USAGE;
    }

    if (route.kind === 'dnd-toggle') {
        bus.emit('system:dnd:toggle');
        return EXIT_OK;
    }

    if (!app.lookup_action(route.action)) {
        logger.warn('dbus', `unknown action: ${route.action}`);
        reply(cmd, `shade-shell: action '${route.action}' is not available`, true);
        return EXIT_FAILURE;
    }
    app.activate_action(
        route.action,
        route.value === undefined ? null : new GLib.Variant('s', route.value)
    );
    return EXIT_OK;
}

function handle(cmd: Gio.ApplicationCommandLine, app: Gio.Application): number {
    const {cli, help} = buildCLI();
    const args = cmd.get_arguments();

    logger.debug('dbus', `requestHandler args=${args.slice(1).join(' ')}`);

    let matched: Quarrel.Command;
    try {
        matched = cli.parse(args);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('dbus', `could not parse args=${args.slice(1).join(' ')}: ${message}`);
        reply(cmd, `shade-shell: ${message}`, true);
        reply(cmd, Quarrel.help(Quarrel.Command.throwing() ?? cli), true);
        return EXIT_USAGE;
    }

    if (help.enabled || matched === cli) {
        reply(cmd, Quarrel.help(matched));
        return EXIT_OK;
    }

    return perf.measureSync(
        `dbus-${matched.get_name()}`,
        () => dispatch(matched, cmd, app),
        'dbus'
    );
}

// ── Entry point ──

/**
 * Handle a remote `shade-shell …` invocation. Output and the exit status go to
 * the calling process; the status is also returned so `vfunc_command_line` can
 * pass it on.
 */
export const requestHandler = (cmd: Gio.ApplicationCommandLine, app: Gio.Application): number => {
    let status = EXIT_FAILURE;
    try {
        status = handle(cmd, app);
    } catch (error) {
        logger.error('dbus', 'requestHandler failed:', error);
        reply(cmd, 'shade-shell: internal error, see the shell log', true);
    } finally {
        cmd.set_exit_status(status);
        cmd.done();
    }
    logger.debug('dbus', `requestHandler done status=${status}`);
    return status;
};
