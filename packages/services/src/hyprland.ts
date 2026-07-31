/**
 * Safe Hyprland adapter.
 *
 * AstalHyprland.get_default() crashes with SIGSEGV when the Hyprland socket
 * doesn't match the (possibly stale) $HYPRLAND_INSTANCE_SIGNATURE env var.
 * This module provides a safe wrapper that checks the socket file first.
 */
import GLib from 'gi://GLib?version=2.0';
import AstalHyprland from 'gi://AstalHyprland?version=0.1';

let cached: AstalHyprland.Hyprland | null | undefined = undefined;

/** Return the Hyprland singleton, or null if unavailable. Never crashes. */
export function getHyprland(): AstalHyprland.Hyprland | null {
    if (cached !== undefined) return cached;

    const his = GLib.getenv('HYPRLAND_INSTANCE_SIGNATURE');
    if (!his) {
        cached = null;
        return null;
    }

    const sock = `${GLib.get_user_runtime_dir()}/hypr/${his}/.socket2.sock`;
    if (!GLib.file_test(sock, GLib.FileTest.EXISTS)) {
        cached = null;
        return null;
    }

    cached = AstalHyprland.get_default();
    return cached;
}

/** Re-exported types for convenience. */
export type {AstalHyprland};
export const Hyprland = AstalHyprland;
