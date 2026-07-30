import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import {render} from '@gnim-js/gtk4';
import {register} from 'gnim/gobject';
import {gettext} from 'gettext';
import {SettingsContext, createAppSettings} from '../../lib/settings';
import {requestHandler} from '../../lib/services/state/requestHandler';
import ShellState from '../../lib/services/state/shellState';
import Screenshot from '../../lib/services/capture/screenshot';
import Touchpad from '../../lib/services/input/touchpad';
import {registerServices, getWidgetDescriptors} from '../../widget';
import ServiceRegistry from '../../lib/core/serviceRegistry';
import logger, {perf} from '../../lib/core/logger';
import {setApp} from '../../lib/services/appHandle';

// gnim dev/bundle auto-registers a Gtk.CssProvider for each imported .css
import './shade.css';

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

    vfunc_command_line(cmd: Gio.ApplicationCommandLine) {
        logger.debug('app', `vfunc_command_line isRemote=${cmd.isRemote}`);
        if (cmd.isRemote) {
            requestHandler(cmd, this);
        } else {
            this.bootstrapUi();
        }
        return 0;
    }

    /** Mount all widgets inside the SettingsProvider context. */
    private bootstrapUi() {
        perf.start('widgets-mount', 'mount');
        this.initIcons();

        const settings = createAppSettings();
        this.#rootDisposers = [];

        // Register and init services (no context needed — settings passed directly)
        registerServices(settings);
        const ok = ServiceRegistry.get_default().initAll();
        if (!ok) {
            logger.error('mount', 'Some services failed to init — continuing');
        }

        // Mount each widget with its own render() for error isolation
        for (const {name, mount: W} of getWidgetDescriptors()) {
            if (name === 'settings') continue; // created lazily by openSettings()
            try {
                perf.start(`widget-${name}`, 'mount');
                this.#rootDisposers.push(
                    render(
                        () => (
                            <SettingsContext value={settings}>
                                <W/>
                            </SettingsContext>
                        ),
                        this,
                    )
                );
                const elapsed = perf.stop(`widget-${name}`, 'mount');
                logger.info('mount', `${name} mounted in ${elapsed.toFixed(1)}ms`);
            } catch (e) {
                logger.error('mount', `Widget ${name} FAILED to mount:`, e);
            }
        }

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
        this.#rootDisposers.forEach(d => d());
        this.#rootDisposers = [];
        ServiceRegistry.get_default().disposeAll();
    }

    shutdown(): void {
        this.#teardown();
        this.quit();
    }
}

export const app = new ShadeShell();
