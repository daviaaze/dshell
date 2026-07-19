/**
 * Type overrides for gnim decorators to work with TypeScript 6's stricter
 * decorator context types. The gnim library (v1.9.1) was written for TS 5.x.
 *
 * Key insight: the GObject property type (used to create the ParamSpec) and
 * the getter's TypeScript return type are separate concerns. `T` describes the
 * ParamSpec; the decorator context accepts any return type via `any`.
 */
import type GObject from 'gi://GObject';

declare module 'gnim/gobject' {
    type PropertyTypeDeclaration<T> =
        | ((name: string, flags: GObject.ParamFlags) => GObject.ParamSpec<T>)
        | GObject.ParamSpec<T>
        | { $gtype: GObject.GType<T> };

    type GetterContext = ClassGetterDecoratorContext<GObject.Object, any>;
    type SetterContext = ClassSetterDecoratorContext<GObject.Object, any>;

    export function getter<T>(
        typeDeclaration: PropertyTypeDeclaration<T>,
    ): (
        get: (this: GObject.Object) => any,
        ctx: GetterContext,
    ) => (this: GObject.Object) => any;

    export function setter<T>(
        typeDeclaration: PropertyTypeDeclaration<T>,
    ): (
        set: (this: GObject.Object, value: any) => void,
        ctx: SetterContext,
    ) => (this: GObject.Object, value: any) => void;

    type SignalContext<M extends (...args: any[]) => any> = ClassFieldDecoratorContext<
        GObject.Object,
        M
    >;

    export function signal(): (
        method: (this: GObject.Object, ...args: any[]) => void,
        ctx: SignalContext<(...args: any[]) => void>,
    ) => void;
}
