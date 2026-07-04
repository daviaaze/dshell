/**
 * A lazily-initialized singleton that defers construction and handles
 * concurrent callers safely.
 *
 * Pattern: first `get()` triggers the factory. If the factory hasn't
 * completed yet, concurrent callers get `null` (no double-init).
 * On error, the result is cached as `null` and subsequent calls
 * return `null` without retrying.
 *
 * Usage:
 *   const notifd = new DeferredSingleton(() => Notifd.get_default())
 *   notifd.get() // → Notifd | null
 *   notifd.initialized // → boolean
 */
export class DeferredSingleton<T> {
    #value: T | null | undefined = undefined;
    #initializing = false;
    #factory: () => T;
    #onError?: (e: unknown) => void;

    constructor(factory: () => T, onError?: (e: unknown) => void) {
        this.#factory = factory;
        this.#onError = onError;
    }

    /** Whether the factory has completed (successfully or with an error). */
    get initialized(): boolean {
        return this.#value !== undefined;
    }

    /**
     * Get the singleton value.
     * - First call: runs the factory, caches the result.
     * - During init: returns null for concurrent callers.
     * - After init: returns the cached value (or null if errored).
     */
    get(): T | null {
        if (this.#value !== undefined) return this.#value;
        if (this.#initializing) return null;

        this.#initializing = true;
        try {
            this.#value = this.#factory();
            return this.#value;
        } catch (e) {
            this.#value = null;
            this.#onError?.(e);
            return null;
        } finally {
            this.#initializing = false;
        }
    }

    /**
     * Reset the singleton. Next call to `get()` will re-run the factory.
     * Use for testing or recovery scenarios.
     */
    reset(): void {
        this.#value = undefined;
        this.#initializing = false;
    }
}
