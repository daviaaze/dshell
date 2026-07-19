// @ts-nocheck — pre-existing GI type gaps; see tsconfig.json for strict mode settings
/**
 * Collision Manager — prevents popup windows from overlapping.
 *
 * When multiple popups (notifications, OSD, quicksettings, launcher, etc.)
 * are visible simultaneously, this manager detects overlaps and shifts
 * lower-priority popups to non-overlapping positions.
 *
 * Priority order (higher = more important, shifts others):
 *   1. Notifications (highest)
 *   2. OSD
 *   3. Quick Settings
 *   4. App Launcher
 *   5. Screenshot UI (lowest)
 */
import Astal from 'gi://Astal?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import logger from '#/lib/core/logger';

// ── Types ──

interface PopupRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

type PopupName = 'notifications' | 'osd' | 'quicksettings' | 'applauncher' | 'screenshot-ui';

const PRIORITY: Record<PopupName, number> = {
    'notifications': 5,
    'osd': 4,
    'quicksettings': 3,
    'applauncher': 2,
    'screenshot-ui': 1,
};

const GAP = 8; // pixels between popups

// ── Manager ──

export class CollisionManager {
    #windows = new Map<PopupName, Astal.Window>();
    #observerIds = new Map<PopupName, number[]>();

    /**
     * Register a popup window for collision management.
     * @param name - Unique popup name.
     * @param win - The Astal.Window instance.
     */
    register(name: PopupName, win: Astal.Window): void {
        this.#windows.set(name, win);

        // Watch visibility changes
        const mapId = win.connect('map', () => this.#resolve());
        const unmapId = win.connect('unmap', () => this.#resolve());
        const notifyVisId = win.connect('notify::visible', () => this.#resolve());

        this.#observerIds.set(name, [mapId, unmapId, notifyVisId]);
    }

    /**
     * Unregister a popup window.
     */
    unregister(name: PopupName): void {
        const win = this.#windows.get(name);
        const ids = this.#observerIds.get(name);
        if (win && ids) {
            for (const id of ids) win.disconnect(id);
        }
        this.#windows.delete(name);
        this.#observerIds.delete(name);
        this.#resolve();
    }

    // ── Collision resolution ──

    #resolve(): void {
        const visiblePops: Array<{name: PopupName; rect: PopupRect; win: Astal.Window}> = [];

        for (const [name, win] of this.#windows) {
            if (!win.visible || !win.get_realized()) continue;
            const monitor = win.get_current_monitor();
            if (monitor === -1) continue;

            // Compute rectangle from position and size
            const [x, y] = win.get_position();
            const width = win.get_width();
            const height = win.get_height();
            if (width <= 0 || height <= 0) continue;

            visiblePops.push({name, rect: {x, y, width, height}, win});
        }

        // Sort by priority ascending (lowest first, shifted first)
        visiblePops.sort((a, b) => PRIORITY[a.name] - PRIORITY[b.name]);

        // Pairwise overlap resolution
        for (let i = 0; i < visiblePops.length; i++) {
            for (let j = i + 1; j < visiblePops.length; j++) {
                const lower = visiblePops[i]!;
                const higher = visiblePops[j]!;

                if (this.#overlaps(lower.rect, higher.rect)) {
                    this.#shiftAway(lower, higher);
                }
            }
        }
    }

    #overlaps(a: PopupRect, b: PopupRect): boolean {
        return !(
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y
        );
    }

    #shiftAway(
        lower: {name: PopupName; rect: PopupRect; win: Astal.Window},
        higher: {name: PopupName; rect: PopupRect},
    ): void {
        const monIdx = lower.win.get_current_monitor();
        const display = Gdk.Display.get_default();
        if (!display) return;

        const monitor = display.get_monitor(monIdx);
        if (!monitor) return;

        const geo = monitor.geometry;

        // Try shifting the lower-priority popup to the right, then left, then down, then up
        const candidates = [
            higher.rect.x + higher.rect.width + GAP, // right
            higher.rect.x - lower.rect.width - GAP, // left
            higher.rect.y + higher.rect.height + GAP, // below
            higher.rect.y - lower.rect.height - GAP, // above
        ];

        let bestX = lower.rect.x;
        let bestY = lower.rect.y;

        for (const candidate of candidates) {
            // For horizontal shift
            const newX = candidate;
            const testRect = {...lower.rect, x: newX};
            if (
                !this.#overlaps(testRect, higher.rect) &&
                newX >= geo.x &&
                newX + lower.rect.width <= geo.x + geo.width
            ) {
                bestX = newX;
                break;
            }
        }

        // Apply shift
        if (bestX !== lower.rect.x) {
            lower.win.set_position(bestX, bestY);
            logger.debug('collision', `shifted ${lower.name} to (${bestX}, ${bestY})`);
        }
    }
}