import type Gtk from 'gi://Gtk?version=4.0';

export const SURFACE_EDGE_GAP = 4;
export const SURFACE_PADDING = 12;
export const SURFACE_SPACING = 8;
export const SURFACE_SECTION_SPACING = 12;
export const COMPACT_SURFACE_PADDING = 8;
export const OPAQUE_SURFACE_CSS = 'background-color: @window_bg_color; color: @window_fg_color;';

/** Maximum popup height in application pixels, reserving its edge margins. */
export function getPopoverMaxHeight(
    anchor: Pick<Gtk.Widget, 'get_display' | 'get_native'>
): number {
    const display = anchor.get_display();
    const surface = anchor.get_native()?.get_surface() ?? null;
    const monitor = surface ? display.get_monitor_at_surface(surface) : null;
    // Gdk.Monitor geometry is already in application pixels: no scale division.
    if (monitor) return Math.max(1, monitor.get_geometry().height - SURFACE_EDGE_GAP * 2);
    return 600;
}
