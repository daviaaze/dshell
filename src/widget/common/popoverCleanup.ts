import {logger} from '#/lib/core/logger';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Connects a widget's destroy signal to unparent its popover.
 * Prevents GTK warnings about popovers with stale parent references.
 * Usage: `<Adw.SplitButton ref={usePopoverCleanup} ... />`
 */
export function usePopoverCleanup<T extends Gtk.Widget>(self: T) {
    self.connect('destroy', () => {
        const popover = ('popover' in self ? (self as Gtk.Widget & {popover?: Gtk.Popover | null}).popover : null) ?? ('get_popover' in self ? (self as Gtk.MenuButton).get_popover() : undefined);
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
