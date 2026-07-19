/**
 * Polyfills for gnim APIs used by the codebase but not available in 1.9.1.
 *
 * gnim 2.x introduced `Accessor.prototype.as()` which is used extensively
 * in widget code. This polyfill adds it to the 1.9.1 Accessor class.
 */
import {Accessor} from 'gnim';

type Callback = () => void;
type DisposeFn = () => void;

// gnim's Accessor extends Function, making the constructor signature opaque.
// This is the cleanest polyfill pattern — augment the interface + construct via new.
declare module 'gnim' {
    interface Accessor<T> {
        as<R>(fn: (value: T) => R): Accessor<R>;
    }
}

(Accessor.prototype as Accessor<unknown>).as = function as<T, R>(
    this: Accessor<T>,
    fn: (value: T) => R,
): Accessor<R> {
    const self = this;
    const Ctor = Accessor as unknown as new (
        get: () => R,
        subscribe: (cb: Callback) => DisposeFn,
    ) => Accessor<R>;
    return new Ctor(() => fn(self()), () => self as unknown as () => void);
};
