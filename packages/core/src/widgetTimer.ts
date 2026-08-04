import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

/**
 * Run `tick` every `intervalMs` for as long as `widget` stays attached to the
 * widget tree. The timer stops automatically once the widget is unparented or
 * destroyed, so callers can't leak GLib sources.
 *
 * Return `false` from `tick` to stop early.
 *
 * Use this for widget-coupled periodic UI work (progress countdowns, frame
 * updates) instead of hand-rolling GLib.timeout_add in widgets — the cleanup
 * contract lives in exactly one place.
 */
export function tickWhileAttached(
    widget: Gtk.Widget,
    intervalMs: number,
    tick: () => void | boolean
): void {
    let active = true;
    const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
        if (!widget.get_parent()) {
            active = false;
            return GLib.SOURCE_REMOVE;
        }
        const result = tick();
        if (result === false) {
            active = false;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    widget.connect('destroy', () => {
        if (active) {
            active = false;
            GLib.source_remove(sourceId);
        }
    });
}
