import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import type {ScreenshotHandle} from './types';

/** Register GAction commands for screenshot/recording. */
export function registerCommands(ss: ScreenshotHandle, app: Gio.Application) {
    const actions: Record<string, () => void> = {
        screenshot: () => ss.screenshot(true),
        'screenshot-area': () => ss.screenshot(false),
        'screenshot-overlay': () => ss.toggleOverlay(),
        record: () => ss.toggleRecording(),
        'record-area': () => ss.recordArea(),
        'record-window': () => ss.recordWindow(),
        'record-output': () => ss.recordOutput(),
    };
    for (const [name, fn] of Object.entries(actions)) {
        const action = Gio.SimpleAction.new(name, null);
        action.connect('activate', fn);
        app.add_action(action);
    }

    // record-window-address takes a string parameter (window address)
    const addressAction = Gio.SimpleAction.new(
        'record-window-address',
        GLib.VariantType.new('s')
    );
    addressAction.connect('activate', (_action, param) => {
        const address = param?.get_string()[0];
        if (address) ss.recordWindowByAddress(address);
    });
    app.add_action(addressAction);
}
