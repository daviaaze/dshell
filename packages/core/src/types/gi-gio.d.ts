// GirGen currently emits DBusError.get_remote_error as `et_remote_error`.
// Preserve the native Gio API instead of changing runtime calls to the typo.
declare module 'gi://Gio?version=2.0' {
    import type GLib from 'gi://GLib?version=2.0';

    export namespace GI {
        namespace Gio {
            interface DBusErrorEnum {
                get_remote_error(error: GLib.Error): string | null;
            }
        }
    }
}
