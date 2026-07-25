import {logger} from '#/lib/core/logger';

/**
 * Connects a widget's destroy signal to unparent its popover.
 * Prevents GTK warnings about popovers with stale parent references.
 * Usage: `<Adw.SplitButton ref={usePopoverCleanup} ... />`
 */
export function usePopoverCleanup(self: any) {
    (self as any).connect('destroy', () => {
        const popover = ('popover' in self ? (self as any).popover : null) ?? ('get_popover' in self ? (self as any).get_popover() : undefined);
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
