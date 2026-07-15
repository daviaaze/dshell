import Gdk from 'gi://Gdk?version=4.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';

/**
 * Map an AstalHyprland monitor to the matching Gdk.Monitor by connector
 * name (e.g. "eDP-1", "HDMI-1"). Astal.Window's integer `monitor` property
 * expects a GDK monitor index, which can differ from Hyprland's monitor ID
 * when displays are added/removed. Using the `gdkmonitor` property is safer.
 */
export function gdkMonitorFromHyprland(
    hyprMon: AstalHyprland.Monitor | null
): Gdk.Monitor | null {
    if (!hyprMon) return null;
    const display = Gdk.Display.get_default();
    if (!display) return null;

    const monitors = display.get_monitors();
    const n = monitors.get_n_items();
    for (let i = 0; i < n; i++) {
        const gdkMon = monitors.get_item(i) as Gdk.Monitor;
        if (gdkMon.get_connector() === hyprMon.name) {
            return gdkMon;
        }
    }
    return null;
}
