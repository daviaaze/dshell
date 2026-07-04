#!/usr/bin/env gjs -m
/**
 * Minimal GTK4 test — verifies GJS, Adw, and Gnim work.
 */
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {exit, programInvocationName} from 'system';
import {createRoot} from 'gnim';

const app = new Adw.Application({
    applicationId: 'com.caioasmuniz.shade_shell.minimal',
});

app.connect('activate', () => {
    createRoot(dispose => {
        app.connect('shutdown', dispose);

        const win = new Adw.Window({
            application: app,
            title: 'Minimal Test',
            defaultWidth: 400,
            defaultHeight: 300,
        });

        win.content = (
            <Gtk.Box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
                <Gtk.Label
                    label="Hello from GJS + Gnim + Adw!"
                    cssClasses={['title-1']}
                />
            </Gtk.Box>
        );

        win.present();
    });
});

const code = await app.runAsync([programInvocationName]);
exit(code);
