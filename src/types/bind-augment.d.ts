/**
 * Augmented gnim v2 type overloads.
 *
 * gnim v2's published types don't cover all real-world usage patterns from
 * the codebase. These augmentations add the missing overloads.
 */
import {type Accessor} from 'gnim';

declare module 'gnim' {
    export function bind<O extends import('gnim').Bindable, P extends string>(
        object: O,
        property: P,
        ...rest: string[]
    ): P extends keyof O ? Accessor<O[P]> : Accessor<any>;
}

declare module 'gnim/gobject' {
    // Bare @signal() decorator (no args). gnim v2 ships @signal (no parens)
    // and @signal([Types], Return), but not the bare @signal() call form.
    export function signal(): (
        proto: Object,
        name: string,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>,
    ) => void;
}
