/**
 * Decorator wrappers for gnim that handle nullable types with TS6.
 *
 * gnim's `@getter` and `@setter` decorators are typed for TS5.x decorator
 * contexts. In TS6, `ClassGetterDecoratorContext<This, ReturnType>` is stricter
 * about matching the declared return type, causing errors when a getter returns
 * `Type | null` but the decorator is declared as `@getter(Type)`.
 *
 * These wrappers use looser internal types while preserving the public API.
 */
import {getter as _getter, setter as _setter} from 'gnim/gobject';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getter = _getter as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const setter = _setter as any;
