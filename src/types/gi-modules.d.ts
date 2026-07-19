/**
 * Ambient type declarations for GI modules that don't have generated types
 * via ts-for-gir. These are partial stubs — the full types come from GIR at runtime.
 */

// ── Secret Service (libsecret) ─────────────────────────────────

declare module 'gi://Secret?version=1' {
    namespace Secret {
        class Schema {
            constructor(
                name: string,
                flags: SchemaFlags,
                attributes: Record<string, SchemaAttributeType>,
            );
        }
        const enum SchemaFlags {
            NONE = 0,
        }
        const enum SchemaAttributeType {
            STRING = 0,
        }
        function password_lookup_sync(
            schema: Schema,
            attributes: Record<string, string>,
            cancellable: unknown,
        ): string | null;
        function password_store_sync(
            schema: Schema,
            attributes: Record<string, string>,
            collection: string,
            label: string,
            password: string,
            cancellable: unknown,
        ): boolean;
    }
    // eslint-disable-next-line import/no-default-export
    export default Secret;
}

// ── AstalBrightness ────────────────────────────────────────────

declare module 'gi://AstalBrightness' {
    import type GObject from 'gi://GObject';
    namespace AstalBrightness {
        class Brightness extends GObject.Object {
            static get_default(): Brightness;
            readonly screen: number;
            readonly kbd: number;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalBrightness;
}

// ── AstalGreet ─────────────────────────────────────────────────

declare module 'gi://AstalGreet' {
    namespace Greet {
        class Greeter {
            constructor();
            connect(signal: 'visible-request', callback: (g: Greeter, msg: string) => void): number;
            connect(signal: 'secret-request', callback: (g: Greeter, msg: string) => void): number;
            connect(signal: 'info-message', callback: (g: Greeter, msg: string) => void): number;
            connect(signal: 'error-message', callback: (g: Greeter, msg: string) => void): number;
            connect(signal: string, callback: (...args: any[]) => void): number;
            disconnect(handlerId: number): void;
            start_session(
                cmd: string[],
                env: string[],
                callback: (g: Greeter, res: unknown) => void,
            ): void;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default Greet;
}

// ── AstalWl (Astal Wayland) ────────────────────────────────────

declare module 'gi://AstalWl' {
    import type GObject from 'gi://GObject';
    namespace AstalWl {
        class WlDisplay extends GObject.Object {
            static get_default(): WlDisplay;
            connect(
                signal: 'output-added',
                callback: (wl: WlDisplay, output: Output) => void,
            ): number;
            connect(
                signal: 'output-removed',
                callback: (wl: WlDisplay, output: Output) => void,
            ): number;
        }
        class Output {
            readonly connector: string;
            readonly name: string;
            readonly model: string;
            readonly manufacturer: string;
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
            readonly scale: number;
            readonly subpixel: number;
            readonly transform: number;
            readonly physical_width: number;
            readonly physical_height: number;
            readonly is_monitor: boolean;
        }
    }
    // eslint-disable-next-line import/no-default-export
    export default AstalWl;
}
