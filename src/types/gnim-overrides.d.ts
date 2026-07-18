/**
 * Type overrides for gnim decorators to work with TypeScript 6's stricter
 * decorator context types. The gnim library (v1.9.1) was written for TS 5.x.
 */
import type GObject from 'gi://GObject';

declare module 'gnim/gobject' {
    // ── Relax getter/setter to accept nullable return/value types ──

    type PropertyTypeDeclaration<T> =
        | ((name: string, flags: GObject.ParamFlags) => GObject.ParamSpec<T>)
        | GObject.ParamSpec<T>
        | { $gtype: GObject.GType<T> };

    type GetterContext<T> = ClassGetterDecoratorContext<GObject.Object, T>;
    type SetterContext<T> = ClassSetterDecoratorContext<GObject.Object, T>;

    export function getter<T>(
        typeDeclaration: PropertyTypeDeclaration<T>
    ): (
        get: (this: GObject.Object) => any,
        ctx: GetterContext<T>
    ) => (this: GObject.Object) => any;

    export function setter<T>(
        typeDeclaration: PropertyTypeDeclaration<T>
    ): (
        set: (this: GObject.Object, value: any) => void,
        ctx: SetterContext<T>
    ) => (this: GObject.Object, value: any) => void;
}
