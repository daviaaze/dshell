import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {createRoot} from 'gnim';
import {register} from 'gnim/gobject';
import {gettext} from 'gettext';
import {SettingsProvider} from '#/lib/settings';
import {requestHandler} from '#/lib/services/state/requestHandler';
import ShellState from '#/lib/services/state/shellState';
import Screenshot from '#/lib/services/capture/screenshot';
import Touchpad from '#/lib/services/input/touchpad';
import {widgets} from '#/widget';
import logger, {perf} from '#/lib/core/logger';
import css from './shade.css';
import resetCss from '#/style/reset.css';

@register()
export class ShadeShell extends Adw.Application {
    constructor() {
        super({
            applicationId: import.meta.domain,
            version: import.meta.version,
            flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
        });
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
        const iconDir = GLib.build_filenamev([
            import.meta.datadir,
            'shade-shell',
            'icons',
        ]);
        if (GLib.file_test(iconDir, GLib.FileTest.IS_DIR)) {
            iconTheme.add_search_path(iconDir);
            logger.debug('app', `icon search path added: ${iconDir}`);
        } else {
            logger.warn('app', `icon directory not found: ${iconDir}`);
        }
    }

    private initCss() {
        perf.start('initCss', 'mount');
        const display = Gdk.Display.get_default();
        if (!display) {
            logger.warn('app', 'No display available. Cannot initialize CSS.');
            return;
        }

        // Layer 1 — base resets (tooltips, popovers, accessibility)
        const resetProvider = new Gtk.CssProvider();
        resetProvider.load_from_data(resetCss, -1);
        Gtk.StyleContext.add_provider_for_display(
            display,
            resetProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_USER - 1
        );

        // Layer 2 — shell design tokens and global utility classes
        const provider = new Gtk.CssProvider();
        provider.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            display,
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_USER
        );

        logger.debug('mount', 'CSS providers registered');
        perf.stop('initCss', 'mount');
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

    /** Initialize CSS, then mount all widgets inside the SettingsProvider context. */
    private bootstrapUi() {
        perf.start('widgets-mount', 'mount');
        createRoot(dispose => {
            this.#rootDispose = dispose;
            this.connect('shutdown', () => this.#teardown());
            this.initIcons();
            this.initCss();
            SettingsProvider(() => widgets());
        });
    }

    #rootDispose: (() => void) | null = null;

    #teardown(): void {
        if (!this.#rootDispose) return;
        const dispose = this.#rootDispose;
        this.#rootDispose = null;
        dispose();
    }

    shutdown(): void {
        this.#teardown();
        this.quit();
    }
}

export const app = new ShadeShell();
