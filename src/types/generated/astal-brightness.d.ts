/// <reference path="./glib-2.0.d.ts" />
/// <reference path="./gio-2.0.d.ts" />
/// <reference path="./gobject-2.0.d.ts" />
/// <reference path="./gmodule-2.0.d.ts" />

/**
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in `ts-for-gir` or create a bug report on https://github.com/gjsify/ts-for-gir
 *
 * The based EJS template file is used for the generated .d.ts file of each GIR module like Gtk-4.0, GObject-2.0, ...
 */

declare module 'gi://AstalBrightness?version=0.1' {

// Module dependencies
import type * as GLib from 'gi://GLib?version=2.0'
import type * as Gio from 'gi://Gio?version=2.0'
import type * as GObject from 'gi://GObject?version=2.0'
import type * as GModule from 'gi://GModule?version=2.0'

/**
 * AstalBrightness-0.1
 */


export namespace Subsystem {
    export const $gtype: GObject.GType<Subsystem>;
}

export enum Subsystem {
    LEDS,
    BACKLIGHT,
}


export const MAJOR_VERSION: number;

export const MINOR_VERSION: number;

export const MICRO_VERSION: number;

export const VERSION: string;

export function get_default(): Brightness;

export namespace Brightness {
    // Signal signatures
    interface SignalSignatures extends GObject.Object.SignalSignatures {
        /** @signal */
        "brightness-changed": (arg0: Device) => void;
        "notify::screen": (pspec: GObject.ParamSpec) => void;
        "notify::keyboard": (pspec: GObject.ParamSpec) => void;
        "notify::backlights": (pspec: GObject.ParamSpec) => void;
        "notify::leds": (pspec: GObject.ParamSpec) => void;
    }

    // Constructor properties interface
    export interface ConstructorProps extends GObject.Object.ConstructorProps {
        screen: Device;
        keyboard: Device;
        backlights: DeviceList;
        leds: DeviceList;
    }
}

export class Brightness extends GObject.Object {
    static $gtype: GObject.GType<Brightness>;

    // Properties
    get screen(): Device;

    get keyboard(): Device;

    get backlights(): DeviceList;

    get leds(): DeviceList;

    /**
     * Compile-time signal type information.
     *
     * This instance property is generated only for TypeScript type checking.
     * It is not defined at runtime and should not be accessed in JS code.
     * @internal
     */
    $signals: Brightness.SignalSignatures;

    // Constructors
    constructor(properties?: Partial<Brightness.ConstructorProps>, ...args: any[]);

    _init(...args: any[]): void;

    // Signals
    /** @signal */
    connect<K extends keyof Brightness.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, Brightness.SignalSignatures[K]>): number;
    connect(signal: string, callback: (...args: any[]) => any): number;

    /** @signal */
    connect_after<K extends keyof Brightness.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, Brightness.SignalSignatures[K]>): number;
    connect_after(signal: string, callback: (...args: any[]) => any): number;

    /** @signal */
    emit<K extends keyof Brightness.SignalSignatures>(signal: K, ...args: GObject.GjsParameters<Brightness.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never): void;
    emit(signal: string, ...args: any[]): void;

    // Static methods
    static get_default(): Brightness;

    // Methods
    get_screen(): Device;

    get_keyboard(): Device;

    get_backlights(): DeviceList;

    get_leds(): DeviceList;
}


export namespace DeviceList {
    // Signal signatures
    interface SignalSignatures extends GObject.Object.SignalSignatures {
        /** @signal */
        "device-appeared": (arg0: Device) => void;
        /** @signal */
        "device-removed": (arg0: Device) => void;
        "notify::subsystem": (pspec: GObject.ParamSpec) => void;
        "notify::devices": (pspec: GObject.ParamSpec) => void;
    }

    // Constructor properties interface
    export interface ConstructorProps<A extends GObject.Object = GObject.Object> extends GObject.Object.ConstructorProps, Gio.ListModel.ConstructorProps {
        subsystem: Subsystem;
        devices: Device[];
    }
}

export class DeviceList<A extends GObject.Object = GObject.Object> extends GObject.Object implements Gio.ListModel<A> {
    static $gtype: GObject.GType<DeviceList>;

    // Properties
    get subsystem(): Subsystem;

    get devices(): Device[];

    /**
     * Compile-time signal type information.
     *
     * This instance property is generated only for TypeScript type checking.
     * It is not defined at runtime and should not be accessed in JS code.
     * @internal
     */
    $signals: DeviceList.SignalSignatures;

    // Constructors
    constructor(properties?: Partial<DeviceList.ConstructorProps>, ...args: any[]);

    _init(...args: any[]): void;

    // Signals
    /** @signal */
    connect<K extends keyof DeviceList.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, DeviceList.SignalSignatures[K]>): number;
    connect(signal: string, callback: (...args: any[]) => any): number;

    /** @signal */
    connect_after<K extends keyof DeviceList.SignalSignatures>(signal: K, callback: GObject.SignalCallback<this, DeviceList.SignalSignatures[K]>): number;
    connect_after(signal: string, callback: (...args: any[]) => any): number;

    /** @signal */
    emit<K extends keyof DeviceList.SignalSignatures>(signal: K, ...args: GObject.GjsParameters<DeviceList.SignalSignatures[K]> extends [any, ...infer Q] ? Q : never): void;
    emit(signal: string, ...args: any[]): void;

    // Methods
    get_device(name: string): Device | null;

    get_subsystem(): Subsystem;

    get_devices(): Device[];

    get_item_type(): GObject.GType;

    get_n_items(): number;

    get_item(position: number): A | null;

    items_changed(position: number, removed: number, added: number): void;

    vfunc_get_item(position: number): A | null;

    vfunc_get_item_type(): GObject.GType;

    vfunc_get_n_items(): number;
}


export type BrightnessClass = typeof Brightness;

export abstract class BrightnessPrivate {
    static $gtype: GObject.GType<BrightnessPrivate>;
}


export type DeviceListClass = typeof DeviceList;

export abstract class DeviceListPrivate {
    static $gtype: GObject.GType<DeviceListPrivate>;
}


export type DeviceIface = typeof Device;

export namespace Device {
    /**
     * Interface for implementing Device.
     * Contains only the virtual methods that need to be implemented.
     */
    interface Interface {

        // Virtual methods
        vfunc_get_subsystem(): Subsystem;

        vfunc_get_name(): string;

        vfunc_get_brightness(): number;

        vfunc_set_brightness(value: number): void;

        vfunc_get_real_brightness(): number;

        vfunc_set_real_brightness(value: number): void;

        vfunc_get_max_brightness(): number;
    }


    // Constructor properties interface
    export interface ConstructorProps extends GObject.Object.ConstructorProps {
        subsystem: Subsystem;
        name: string;
        brightness: number;
        real_brightness: number;
        realBrightness: number;
        max_brightness: number;
        maxBrightness: number;
    }
}

export interface DeviceNamespace {
    $gtype: GObject.GType<Device>;
    prototype: Device;
}
export interface Device extends GObject.Object, Device.Interface {

    // Properties
    get subsystem(): Subsystem;

    get name(): string;

    get brightness(): number;
    set brightness(val: number);

    get real_brightness(): number;
    set real_brightness(val: number);

    get realBrightness(): number;
    set realBrightness(val: number);

    get max_brightness(): number;

    get maxBrightness(): number;

    // Methods
    get_subsystem(): Subsystem;

    get_name(): string;

    get_brightness(): number;

    set_brightness(value: number): void;

    get_real_brightness(): number;

    set_real_brightness(value: number): void;

    get_max_brightness(): number;
}


export const Device: DeviceNamespace & {
    new (): Device; // This allows `obj instanceof Device`
};

export const __name__: string;

export const __version__: string;

}

declare module 'gi://AstalBrightness' {
    import AstalBrightness01 from 'gi://AstalBrightness?version=0.1';
    export default AstalBrightness01;
}
// END
