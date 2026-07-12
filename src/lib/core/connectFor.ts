/**
 * Helper for safe GObject signal connections that auto-disconnect on widget cleanup.
 *
 * Usage:
 * ```typescript
 * import { connectFor } from "#/lib/connectFor"
 *
 * // Inside a Gnim $={() => {}} callback, onMount, or createRoot scope:
 * connectFor(self, notifd, "notified", (_, id) => addNotification(id))
 * connectFor(self, bluetooth, "notify::is-powered", () => updateUI())
 * ```
 *
 * When the Gnim node (`self`) is unmounted/destroyed, all signal handlers
 * registered via `connectFor` are automatically disconnected — no manual
 * `onCleanup` needed.
 *
 * For code OUTSIDE a Gnim tree (library services), use the raw object's
 * `connect()` and manage the handler ID manually in `dispose()`.
 */

import type GObject from 'gi://GObject?version=2.0';

// ── Internal tracker ────────────────────────────────────────────

type CleanupEntry = {obj: GObject.Object; handlerId: number};

const nodeRegistry = new WeakMap<object, CleanupEntry[]>();

function getOrCreateEntries(node: object): CleanupEntry[] {
    let entries = nodeRegistry.get(node);
    if (!entries) {
        entries = [];
        nodeRegistry.set(node, entries);
    }
    return entries;
}

/**
 * Register a GObject signal handler that is automatically disconnected
 * when the given Gnim node is cleaned up (unmounted/destroyed).
 *
 * @param node  The Gnim reactive node (`self` inside `$={}`, `onMount`, or similar)
 * @param obj   The GObject instance to connect to
 * @param signal  Signal name (e.g. "notified", "notify::my-prop")
 * @param callback  Signal handler function
 * @returns The GObject handler ID (can be used for manual disconnect before cleanup)
 */
export function connectFor(
    node: object,
    obj: GObject.Object,
    signal: string,
    // GObject signal handlers use variadic args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (...args: any[]) => void
): number {
    const handlerId = obj.connect(signal, callback);
    const entries = getOrCreateEntries(node);
    entries.push({obj, handlerId});
    return handlerId;
}

/**
 * Register a "destroy" signal on a Gtk widget that also runs on Gnim cleanup.
 * Equivalent to `connectFor(self, widget, "destroy", callback)`.
 *
 * @param node  The Gnim reactive node
 * @param widget  The Gtk widget to watch for destruction
 * @param callback  Cleanup function
 * @returns The handler ID
 */
export function connectDestroy(
    node: object,
    widget: GObject.Object,
    callback: () => void
): number {
    return connectFor(node, widget, 'destroy', callback);
}

/**
 * Clean up all signal handlers registered for a given Gnim node.
 * This is called automatically by Gnim's cleanup mechanism via `onCleanup`,
 * but can be invoked manually if needed.
 *
 * @param node  The Gnim node whose handlers should be disconnected
 */
export function cleanupNode(node: object): void {
    const entries = nodeRegistry.get(node);
    if (!entries) return;
    for (const {obj, handlerId} of entries) {
        try {
            obj.disconnect(handlerId);
        } catch {
            // Object may already be finalized — safe to ignore
        }
    }
    nodeRegistry.delete(node);
}
