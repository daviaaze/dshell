/**
 * Monitor Service — Wayland-native monitor tracking via AstalWl.
 *
 * Uses AstalWl.WlDisplay for monitor enumeration and hotplug detection
 * instead of Gdk.Monitor. This gives us:
 *   - Reliable connector names (no fallback chain needed)
 *   - Fires at the Wayland protocol level (before Gdk/Hyprland)
 *   - Eliminates the Gdk ↔ Hyprland pendingSync race condition
 *
 * Feature-flagged: set general.experimental-wayland-monitors to true.
 * The monitors array still returns Gdk.Monitor[] for backward compatibility
 * with Astal.Window.gdkmonitor and all existing widgets.
 */
import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import AstalWl from 'gi://AstalWl';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import {Object, register, property} from 'gnim/gobject';
import {bind} from 'gnim';
import logger from '#/lib/core/logger';

// ── Gdk → Hyprland monitor mapper ────────────────────────────────────────

/**
 * Map a Gdk.Monitor to its corresponding AstalHyprland.Monitor.
 *
 * Uses the Wayland connector name (e.g. "eDP-1", "HDMI-A-1") for matching
 * instead of the EDID model string, which is unreliable when two monitors
 * share the same model (e.g. two Dell U2723QEs).
 *
 * Falls back to description matching and then to geometry matching.
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

// ── AstalWl monitor tracking ──────────────────────────────────────────────

/** Look up a Gdk.Monitor by connector name. */
function gdkMonitorByConnector(connector: string): Gdk.Monitor | null {
    const display = Gdk.Display.get_default();
    if (!display) return null;
    const monitors = display.get_monitors();
    for (let i = 0; i < monitors.get_n_items(); i++) {
        const mon = monitors.get_item(i) as Gdk.Monitor;
        if (mon.connector === connector) return mon;
    }
    return null;
}

/** Collect all Gdk.Monitors as a stable array. */
function allGdkMonitors(): Gdk.Monitor[] {
    const display = Gdk.Display.get_default();
    if (!display) return [];
    const list = display.get_monitors();
    const result: Gdk.Monitor[] = [];
    for (let i = 0; i < list.get_n_items(); i++) {
        result.push(list.get_item(i) as Gdk.Monitor);
    }
    return result;
}

@register({GTypeName: 'MonitorService'})
class MonitorService extends Object {
    static instance: MonitorService;

    static get_default() {
        if (!this.instance) this.instance = new MonitorService();
        return this.instance;
    }

    #monitors: Gdk.Monitor[] = [];
    #wlDisplay: AstalWl.WlDisplay | null = null;
    #wlSignalIds: number[] = [];
    #pendingSync = false;

    @property
    get monitors() {
        return this.#monitors;
    }

    constructor() {
        super();
        this.#tryInit();
    }

    #tryInit() {
        const display = Gdk.Display.get_default();
        if (!display) {
            logger.log('monitors', 'No display available, retrying...');
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this.#tryInit();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        // Check feature flag via GSettings (direct lookup, no context needed)
        let useWl = false;
        try {
            const gsettings = new Gio.Settings({
                schema_id: 'com.caioasmuniz.shade_shell.general',
            });
            useWl = gsettings.get_boolean('experimental-wayland-monitors');
        } catch {
            // Schema not installed yet — use Gdk path
        }

        if (useWl) {
            this.#initAstalWl();
        } else {
            this.#initGdk(display);
        }
    }

    // ── Gdk path (fallback, default) ──────────────────────────────────────

    #initGdk(display: Gdk.Display): void {
        const monitorList = display.get_monitors();
        this.#updateMonitors(allGdkMonitors());

        monitorList.connect('items-changed', () => {
            this.#updateMonitors(allGdkMonitors());
        });

        // Sync with Hyprland's monitor list to handle the race condition:
        // Gdk fires items-changed before Hyprland's IPC has updated its own
        // monitor list. When the Hyprland list catches up, re-notify.
        const hyprland = AstalHyprland.get_default();
        hyprland.connect('notify::monitors', () => {
            if (this.#pendingSync) {
                this.#pendingSync = false;
                this.notify('monitors');
            }
        });
    }

    // ── AstalWl path (experimental) ───────────────────────────────────────

    #initAstalWl(): void {
        const display = Gdk.Display.get_default();
        if (!display) return;

        try {
            this.#wlDisplay = AstalWl.WlDisplay.get_default();
        } catch (e) {
            logger.warn('monitors', 'AstalWl unavailable, falling back to Gdk:', e);
            this.#initGdk(display);
            return;
        }

        // Initial population
        this.#updateMonitors(allGdkMonitors());

        // Listen for output changes
        this.#wlSignalIds = [
            this.#wlDisplay.connect('output-added', (_wl: AstalWl.WlDisplay, output: AstalWl.Output) => {
                const gdkMon = gdkMonitorByConnector(output.name);
                if (gdkMon) {
                    this.#addMonitor(gdkMon);
                } else {
                    // Gdk hasn't caught up yet — retry
                    this.#scheduleHyprlandSync();
                }
            }),

            this.#wlDisplay.connect('output-removed', (_wl: AstalWl.WlDisplay, output: AstalWl.Output) => {
                const gdkMon = gdkMonitorByConnector(output.name);
                if (gdkMon) {
                    this.#removeMonitor(gdkMon);
                } else {
                    // Gdk already removed it — resync all
                    this.#updateMonitors(allGdkMonitors());
                }
            }),
        ];

        // Sync with Hyprland after AstalWl fires (allow Hyprland IPC to catch up)
        const hyprland = AstalHyprland.get_default();
        this.#wlSignalIds.push(
            hyprland.connect('notify::monitors', () => {
                if (this.#pendingSync) {
                    this.#pendingSync = false;
                    this.#updateMonitors(allGdkMonitors());
                }
            })
        );
    }

    // ── Monitor list management ───────────────────────────────────────────

    #addMonitor(monitor: Gdk.Monitor): void {
        // Avoid duplicates
        if (this.#monitors.some(m => m.connector === monitor.connector)) return;
        this.#monitors = [...this.#monitors, monitor];
        this.#scheduleHyprlandSync();
    }

    #removeMonitor(monitor: Gdk.Monitor): void {
        this.#monitors = this.#monitors.filter(m => m.connector !== monitor.connector);
        this.notify('monitors');
    }

    #updateMonitors(monitors: Gdk.Monitor[]): void {
        this.#monitors = monitors;

        // Check if Hyprland monitor list matches the Gdk count
        const hyprland = AstalHyprland.get_default();
        if (hyprland.get_monitors().length !== this.#monitors.length) {
            this.#pendingSync = true;
            logger.debug('monitors', 'Monitor counts differ, deferring notify');
        } else {
            this.#pendingSync = false;
        }

        this.notify('monitors');
    }

    #scheduleHyprlandSync(): void {
        // Defer notification to give Hyprland IPC time to catch up
        const hyprland = AstalHyprland.get_default();
        if (hyprland.get_monitors().length !== this.#monitors.length) {
            this.#pendingSync = true;
            logger.debug('monitors', 'Monitor counts differ, deferring notify');
        } else {
            this.#pendingSync = false;
            this.notify('monitors');
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    dispose(): void {
        if (this.#wlDisplay && this.#wlSignalIds.length > 0) {
            for (const id of this.#wlSignalIds) {
                this.#wlDisplay.disconnect(id);
            }
            this.#wlSignalIds = [];
        }
    }
}

// ── Exports ───────────────────────────────────────────────────────────────

export const monitors = bind(MonitorService.get_default(), 'monitors');

export {Gdk2HyprMonitor, MonitorService};