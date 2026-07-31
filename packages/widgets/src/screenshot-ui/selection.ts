/**
 * Screenshot selection geometry helpers.
 *
 * Pure functions extracted from the screenshot-ui widget for testability
 * and to keep the widget focused on rendering and event handling.
 */

export interface Point {
    x: number;
    y: number;
}

export interface WinInfo {
    address: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
}

export interface SelectionState {
    dragStart: Point | null;
    dragEnd: Point | null;
    selActive: boolean;
    selectedWindow: WinInfo | null;
    windows: WinInfo[];
    monOrigin: Point;
}

/** Normalize two points into a {x, y, width, height} rect. */
export function normalizeRect(
    a: Point,
    b: Point
): {x: number; y: number; width: number; height: number} {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
    };
}

/** Check if the current mode is screenshot (vs recording). */
export function isScreenshotMode(selectedMode: string): boolean {
    return selectedMode === 'screenshot';
}

/**
 * Build a grim-format geometry string from the current selection state.
 * Returns null if no valid selection exists.
 */
export function buildGeometry(
    target: string,
    sel: SelectionState
): string | null {
    if (target === 'fullscreen' || target === 'monitor') return null;

    if (target === 'area') {
        if (!sel.selActive || !sel.dragStart || !sel.dragEnd) return null;
        const rect = normalizeRect(sel.dragStart, sel.dragEnd);
        if (rect.width < 5 || rect.height < 5) return null;
        return `${rect.width}x${rect.height}+${rect.x}+${rect.y}`;
    }

    if (target === 'window') {
        if (!sel.selectedWindow) return null;
        const origin = sel.monOrigin;
        const w = sel.selectedWindow;
        return `${w.width}x${w.height}+${w.x - origin.x}+${w.y - origin.y}`;
    }

    return null;
}

/**
 * Load windows from Hyprland client list, filtering out zero-size entries.
 */
export function loadWindows(
    clients: Array<{
        address: string;
        x: number;
        y: number;
        width: number;
        height: number;
        title: string;
    }>
): WinInfo[] {
    const list: WinInfo[] = [];
    for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        if (c.width > 0 && c.height > 0) {
            list.push({
                address: c.address,
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
                title: c.title,
            });
        }
    }
    return list;
}

/** Get the origin of the currently focused monitor. */
export function getMonitorOrigin(
    focusedMonitor: {x: number; y: number} | null
): Point {
    return focusedMonitor
        ? {x: focusedMonitor.x, y: focusedMonitor.y}
        : {x: 0, y: 0};
}
