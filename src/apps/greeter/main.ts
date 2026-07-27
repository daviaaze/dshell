/**
 * Greeter entry point — launched by greetd at login time.
 *
 * Minimal bootstrap: just runs the Gtk main loop and shows
 * the greeter login UI in a layer-shell window.
 *
 * greetd config:
 * ```toml
 * [default_session]
 * command = "/path/to/shade-shell-greet"
 * ```
 */
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {programArgs, programInvocationName, exit} from 'system';
import {render} from '@gnim-js/gtk4';
import {Greeter} from '#/widget/greeter';
import logger from '#/lib/core/logger';

// ── Minimal Gtk application ──

const appId = 'com.caioasmuniz.shade_shell.greeter';

const app = new Gtk.Application({
    applicationId: appId,
    flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});

GLib.set_prgname('shade-shell-greet');

app.connect('activate', () => {
    logger.info('greeter', 'activating greeter UI');
    // Render the greeter UI which creates its own Astal.Window
    const dispose = render(() => Greeter({application: app}), app);
    app.connect('shutdown', dispose);
});

// ── Run ──

app.run([programInvocationName, ...programArgs]);
exit(0);
