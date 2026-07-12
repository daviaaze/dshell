import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject, {getter, register} from 'gnim/gobject';
import {createBinding} from 'gnim';
import logger from '#/lib/core/logger';

/**
 * Map a Gdk.Monitor to its corresponding AstalHyprland.Monitor.
 *
 * Uses the Wayland connector name (e.g. "eDP-1", "HDMI-A-1") for matching
 * instead of the EDID model string, which is unreliable when two monitors
 * share the same model (e.g. two Dell U2723QEs).
 *
 * Falls back to description matching and then to the first monitor.
 */
const Gdk2HyprMonitor = (GMonitor: Gdk.Monitor): AstalHyprland.Monitor => {
    const hyprland = AstalHyprland.get_default();

    // Gdk 4.10+ exposes the connector name directly
    const connector = GMonitor.connector;
    if (connector) {
        const found = hyprland.get_monitor_by_name(connector);
        if (found) return found;
        logger.warn('monitors', `Hyprland monitor not found for connector: ${connector}`);
    }

    // Fallback: match by description (includes connector info in some setups)
    const desc = GMonitor.description;
    if (desc) {
        const found = hyprland.get_monitors().find(m => m.description === desc);
        if (found) return found;
    }

    // Last resort: find the first monitor with matching geometry
    const geo = GMonitor.geometry;
    const found = hyprland.get_monitors().find(m => m.x === geo.x && m.y === geo.y);
    return found ?? hyprland.get_monitor(0);
};

@register({GTypeName: 'MonitorService'})
class MonitorService extends GObject.Object {
    static readonly instance: MonitorService;

    static get_default() {
        if (!this.instance) this.instance = new MonitorService();
        return this.instance;
    }

    #monitors: Gdk.Monitor[] = [];

    @getter(Array)
    get monitors() {
        return this.#monitors;
    }

    #initialized = false;
    #pendingSync = false;

    constructor() {
        super();
        this.#tryInit();
    }

    #tryInit() {
        if (this.#initialized) return;
        const display = Gdk.Display.get_default();
        if (!display) {
            logger.log(
                'No display available for monitor tracking, retrying...'
            );
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this.#tryInit();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        this.#initialized = true;
        const monitorList = display.get_monitors();
        this.#update(monitorList);

        // Listen for Gdk monitor changes (plug/unplug events)
        monitorList.connect('items-changed', () => {
            this.#update(monitorList);
        });

        // Sync with Hyprland's monitor list to handle the race condition:
        // Gdk fires items-changed before Hyprland's IPC has updated its own
        // monitor list. When the Hyprland list catches up, re-notify so that
        // widgets (bars, wallpapers) re-render with correct workspace mappings.
        const hyprland = AstalHyprland.get_default();
        hyprland.connect('notify::monitors', () => {
            if (this.#pendingSync) {
                this.#pendingSync = false;
                this.notify('monitors');
            }
        });
    }

    #update(monitorList: Gio.ListModel) {
        this.#monitors = Array.from(monitorList as Gio.ListStore<Gdk.Monitor>);

        // Check if Hyprland monitor list matches the Gdk count
        const hyprland = AstalHyprland.get_default();
        if (hyprland.get_monitors().length !== this.#monitors.length) {
            this.#pendingSync = true;
            logger.debug('monitors', 'Gdk and Hyprland monitor counts differ, deferring notify');
        } else {
            this.#pendingSync = false;
        }

        this.notify('monitors');
    }
}

export const monitors = createBinding(MonitorService.get_default(), 'monitors');

export {Gdk2HyprMonitor, MonitorService};
