import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {logger} from '#/lib/core/logger';

/**
 * Connects a widget's destroy signal to unparent its popover.
 * Prevents GTK warnings about popovers with stale parent references.
 * Usage: `<Adw.SplitButton ref={usePopoverCleanup} ... />`
 */
export function usePopoverCleanup(
    self: Adw.SplitButton | Gtk.MenuButton | Gtk.Widget
) {
    GObject.signal_connect(self, 'destroy', () => {
        const popover =
            (self instanceof Adw.SplitButton ? self.popover : null) ??
            (self instanceof Gtk.MenuButton ? self.get_popover() : undefined);
        if (popover) {
            try {
                popover.popdown();
            } catch (e) {
                logger.warn(`${e}`);
            }
            if (popover.parent) popover.unparent();
        }
    });
}
