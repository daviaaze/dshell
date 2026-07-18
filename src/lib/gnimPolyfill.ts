/**
 * Polyfills for gnim APIs used by the codebase but not available in 1.9.1.
 *
 * gnim 2.x introduced `Accessor.prototype.as()` which is used extensively
 * in widget code. This polyfill adds it to the 1.9.1 Accessor class.
 */
import {Accessor} from 'gnim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Accessor.prototype as any).as = function as<T, R>(
    this: Accessor<T>,
    fn: (value: T) => R
): Accessor<R> {
    const self = this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (Accessor as any)(() => fn(self()), () => self as unknown as () => void) as Accessor<R>;
};
