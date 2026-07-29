/**
 * Typed synchronous event bus for cross-service communication.
 *
 * Usage:
 * ```ts
 * import {bus} from './eventBus';
 *
 * // Subscribe
 * const unsub = bus.on('shell:lockscreen', () => lockScreen());
 * // Unsubscribe
 * unsub();
 *
 * // Emit
 * bus.emit('capture:screenshot', true);
 * ```
 *
 * Events are dispatched synchronously — no queue, no async.
 * This matches GObject signal semantics and avoids ordering surprises.
 */

export interface EventMap {
    'shell:launcher:toggle': void;
    'shell:qs:toggle': void;
    'shell:bar:toggle': void;
    'shell:clipboard:toggle': void;
    'shell:clipboard:open': void;
    'shell:lockscreen': void;
    'shell:settings:open': void;
    'shell:windowswitcher:toggle': void;
    'capture:screenshot': boolean; // fullScreen
    'capture:screenshot:area': void;
    'capture:screenshot:overlay': void;
    'capture:record': void;
    'capture:record:area': void;
    'capture:record:window': void;
    'capture:record:window:address': string;
    'capture:record:output': void;
    'input:touchpad:toggle': void;
    'system:dnd:toggle': void;
    'system:dnd:set': boolean;
    'system:dnd:changed': boolean;
}

type Unsubscribe = () => void;

class EventBus {
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on<K extends keyof EventMap>(
        event: K,
        fn: (payload: EventMap[K]) => void
    ): Unsubscribe {
        const key = event;
        if (!this.#listeners.has(key)) {
            this.#listeners.set(key, new Set());
        }
        this.#listeners.get(key)!.add(fn as (...args: unknown[]) => void);
        return () => {
            this.#listeners
                .get(key)
                ?.delete(fn as (...args: unknown[]) => void);
        };
    }

    emit<K extends keyof EventMap>(
        event: K,
        ...args: EventMap[K] extends void ? [] : [payload: EventMap[K]]
    ): void {
        const key = event;
        const fns = this.#listeners.get(key);
        if (!fns) return;
        for (const fn of fns) {
            fn(...(args));
        }
    }

    /** Remove all listeners for a specific event. */
    clear(event: keyof EventMap): void {
        this.#listeners.delete(event);
    }

    /** Remove all listeners for all events. */
    clearAll(): void {
        this.#listeners.clear();
    }
}

export const bus = new EventBus();
