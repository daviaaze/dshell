import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import logger, {perf} from '@shade/core/logger';
import ServiceRegistry from '@shade/core/serviceRegistry';
import {setApp} from '@shade/services/appHandle';
import Screenshot from '@shade/services/capture/screenshot';
import Touchpad from '@shade/services/input/touchpad';
import {requestHandler} from '@shade/services/state/requestHandler';
import ShellState from '@shade/services/state/shellState';
import {boot} from '@shade/widgets/index';
import {gettext} from 'gettext';
import {register} from 'gnim/gobject';

// gnim dev/bundle auto-registers a Gtk.CssProvider for each imported .css

@register
export class ShadeShell extends Adw.Application {
    constructor() {
        super({
            applicationId: import.meta.domain,
            version: import.meta.version,
            flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
        });
        setApp(this);
        GLib.set_prgname(import.meta.name);
        GLib.set_application_name(gettext('Shade Shell'));
        ShellState.get_default().registerCommands(this);
        Screenshot.get_default().registerCommands(this);
        Touchpad.get_default().registerCommands(this);
    }

    private initIcons() {
        const display = Gdk.Display.get_default();
        if (!display) return;
        const iconTheme = Gtk.IconTheme.get_for_display(display);
        const iconDir = GLib.build_filenamev([import.meta.datadir, 'shade-shell', 'icons']);
        if (GLib.file_test(iconDir, GLib.FileTest.IS_DIR)) {
            iconTheme.add_search_path(iconDir);
            logger.debug('app', `icon search path added: ${iconDir}`);
        } else {
            logger.warn('app', `icon directory not found: ${iconDir}`);
        }
    }

    vfunc_command_line(cmd: Gio.ApplicationCommandLine) {
        logger.debug('app', `vfunc_command_line isRemote=${cmd.isRemote}`);
        if (cmd.isRemote) {
            requestHandler(cmd, this);
        } else {
            this.bootstrapUi();
        }
        return 0;
    }

    /** Mount all widgets. The composition root (boot) handles settings,
     *  services, action wiring, and per-widget mounting with error isolation. */
    private bootstrapUi() {
        perf.start('widgets-mount', 'mount');
        this.initIcons();

        this.#rootDisposers = boot(this);

        GObject.signal_connect(this, 'shutdown', () => this.#teardown());
        perf.stop('widgets-mount', 'mount');
    }

    #rootDisposers: (() => void)[] = [];
    #disposed = false;

    /** Idempotent: disposes widgets AND services (clipboard flush,
     *  file monitors, timers, DBus connections) on any shutdown path. */
    #teardown(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#rootDisposers.forEach((d) => d());
        this.#rootDisposers = [];
        ServiceRegistry.get_default().disposeAll();
    }

    shutdown(): void {
        this.#teardown();
        this.quit();
    }
}

export const app = new ShadeShell();
