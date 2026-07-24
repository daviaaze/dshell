/**
 * Augmented bind() overloads for gnim v2.
 *
 * gnim v2's bind() types the property key strictly via $readableProperties,
 * which doesn't include Astal's dynamic properties (focusedMonitor, etc.)
 * that exist as getters. The fallback overload below infers the value type
 * from the object when the property is a known key (including getters), and
 * only falls back to Accessor<any> for truly unknown properties.
 */
import {type Accessor} from 'gnim';

declare module 'gnim' {
    export function bind<O extends import('gnim').Bindable, P extends string>(
        object: O,
        property: P,
        ...rest: string[]
    ): P extends keyof O ? Accessor<O[P]> : Accessor<any>;
}
