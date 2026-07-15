import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';

/**
 * Map an AstalHyprland monitor to the matching GDK monitor index by
 * connector name (e.g. "eDP-1", "HDMI-1"). Astal.Window's `monitor`
 * property expects a GDK monitor index, but Hyprland's monitor ID can
 * differ from that index after displays are added/removed. This helper
 * returns the correct integer index for the currently focused monitor.
 */
export function monitorIndexFromHyprland(
    hyprMon: AstalHyprland.Monitor | null
): number {
    if (!hyprMon) return 0;
    const display = Gdk.Display.get_default();
    if (!display) return 0;

    const monitors = display.get_monitors();
    const n = monitors.get_n_items();
    for (let i = 0; i < n; i++) {
        const gdkMon = monitors.get_item(i) as Gdk.Monitor;
        if (gdkMon.get_connector() === hyprMon.name) {
            return i;
        }
    }
    return 0;
}
