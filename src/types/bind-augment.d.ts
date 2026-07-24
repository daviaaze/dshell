/**
 * Loose bind() overload for gnim v2.
 *
 * gnim v2's bind() types the property key strictly via $readableProperties,
 * which doesn't include Astal's dynamic properties (focusedMonitor, etc.) or
 * properties on services that don't declare $readableProperties. This adds a
 * fallback overload that accepts any string, matching bind()'s runtime
 * behavior (it reads object[property] regardless of static type).
 *
 * The original strict overloads still match when a property IS in
 * $readableProperties, so well-typed calls keep their precise return types.
 */
import {type Accessor} from 'gnim';

declare module 'gnim' {
    export function bind(object: any, property: string, ...rest: string[]): Accessor<any>;
}
