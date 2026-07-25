/**
 * Type augmentation for gnim v2 property decorator.
 *
 * gnim v2's runtime pspec() function handles JS globals (Object, Array,
 * String, Number, Boolean) but the published TypeScript types don't
 * include them. This augmentation adds the missing overloads so complex
 * types (objects, arrays) can use @property(Object) or @property(Array).
 *
 * Note: files import `Object` from gnim/gobject (GObject.ObjectClass),
 * which is what gets passed to @property(). The augmentation accepts
 * both the gnim Object class and JS globals.
 */
import type {Object as GObjectObject} from 'gnim/gobject';

declare module 'gnim/gobject' {
    /**
     * Additional property overloads for JS global constructors and the
     * gnim Object class. gnim v2's pspec() handles these at runtime:
     * - Object, Array, Function → ParamSpec.jsobject
     * - String → ParamSpec.string
     * - Number → ParamSpec.double
     * - Boolean → ParamSpec.boolean
     */
    function property(
        type:
            | StringConstructor
            | BooleanConstructor
            | NumberConstructor
            | ObjectConstructor
            | ArrayConstructor
            | typeof GObjectObject
    ): (
        proto: GObjectObject,
        name: string,
        value?: TypedPropertyDescriptor<any>
    ) => void;
}
