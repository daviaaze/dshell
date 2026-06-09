import { logger } from "#/lib/logger";
import Gtk from "gi://Gtk?version=4.0"

/**
 * Connects a widget's destroy signal to unparent its popover.
 * Prevents GTK warnings about popovers with stale parent references.
 * Usage: `<Adw.SplitButton $={usePopoverCleanup} ... />`
 */
export function usePopoverCleanup(
  self: Gtk.Widget & { popover?: Gtk.Popover } | Gtk.MenuButton,
) {
  self.connect("destroy", () => {
    const popover = self.popover ?? (self as any).get_popover?.()
    if (popover) {
      try {
        popover.popdown()
      } catch (e) {
        logger.warn(`${e}`)
      }
      if (popover.parent) popover.unparent()
    }
  })
}
