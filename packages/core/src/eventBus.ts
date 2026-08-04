/**
 * Typed synchronous event bus -- generic mechanism, domain-free.
 *
 * Domains own their event contracts (see each services/<domain>/contract.ts) and
 * compose them into a root event map. `createBus<T>()` builds a bus typed to
 * that map. The shared app-wide bus lives in src/lib/services/bus.ts.
 *
 * Events are dispatched synchronously -- no queue, no async. This matches
 * GObject signal semantics and avoids ordering surprises.
 */

export type Unsubscribe = () => void;

export class EventBus<E> {
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): Unsubscribe {
        const key = event as string;
        if (!this.#listeners.has(key)) {
            this.#listeners.set(key, new Set());
        }
        this.#listeners.get(key)!.add(fn as (...args: unknown[]) => void);
        return () => {
            this.#listeners.get(key)?.delete(fn as (...args: unknown[]) => void);
        };
    }

    emit<K extends keyof E>(event: K, ...args: E[K] extends void ? [] : [payload: E[K]]): void {
        const key = event as string;
        const fns = this.#listeners.get(key);
        if (!fns) return;
        for (const fn of fns) {
            fn(...(args as unknown[]));
        }
    }

    /** Remove all listeners for a specific event. */
    clear(event: keyof E): void {
        this.#listeners.delete(event as string);
    }

    /** Remove all listeners for all events. */
    clearAll(): void {
        this.#listeners.clear();
    }
}

/** Build a typed bus for the given event map. */
export function createBus<E>(): EventBus<E> {
    return new EventBus<E>();
}
