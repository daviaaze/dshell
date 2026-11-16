import type Gtk from 'gi://Gtk?version=4.0';

export const SURFACE_EDGE_GAP = 4;
export const SURFACE_PADDING = 12;
export const SURFACE_SPACING = 8;
export const SURFACE_SECTION_SPACING = 12;
export const COMPACT_SURFACE_PADDING = 8;
export const OPAQUE_SURFACE_CSS = 'background-color: @window_bg_color; color: @window_fg_color;';

/** Maximum popup height in GDK logical coordinates, reserving its edge margins. */
export function getPopoverMaxHeight(
    anchor: Pick<Gtk.Widget, 'get_display' | 'get_native'>
): number {
    const display = anchor.get_display();
    const surface = anchor.get_native()?.get_surface() ?? null;
    const monitor = surface ? display.get_monitor_at_surface(surface) : null;
    if (monitor) {
        const geometry = monitor.get_geometry();
        const scale = monitor.get_scale_factor() || 1;
        return Math.max(1, geometry.height / scale - SURFACE_EDGE_GAP * 2);
    }
    return 600;
}
