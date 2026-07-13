#!@gjs@ -m

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
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import {programArgs, programInvocationName, exit} from 'system';
import {createRoot} from 'gnim';
import {Greeter} from '#/widget/greeter';

// ── Minimal Gtk application ──

const appId = 'com.caioasmuniz.shade_shell.greeter';

const app = new Gio.Application({
    applicationId: appId,
    flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});

GLib.set_prgname('shade-shell-greet');

app.connect('activate', () => {
    // Create the greeter UI which handles its own Astal.Window
    createRoot(dispose => {
        app.connect('shutdown', dispose);
        Greeter({application: app});
    });
});

// ── Run ──

app.run([programInvocationName, ...programArgs]);
exit(0);