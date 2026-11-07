/**
 * Safe Hyprland adapter.
 *
 * AstalHyprland.get_default() crashes with SIGSEGV when the Hyprland socket
 * doesn't match the (possibly stale) $HYPRLAND_INSTANCE_SIGNATURE env var.
 * This module provides a safe wrapper that checks the socket file first.
 */

import AstalHyprland from 'gi://AstalHyprland?version=0.1';
import GLib from 'gi://GLib?version=2.0';

let cached: AstalHyprland.Hyprland | null | undefined;

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

export interface HyprlandClientSnapshot {
    address: string;
    title: string;
    mapped: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Read compositor geometry at the capture action, never Astal's cached clients. */
export function getHyprlandClientSnapshot(): HyprlandClientSnapshot[] {
    const hyprland = getHyprland();
    if (!hyprland) throw new Error('Hyprland is unavailable');
    const clients = JSON.parse(hyprland.message('j/clients')) as Array<{
        address: string;
        title: string;
        mapped: boolean;
        at: [number, number];
        size: [number, number];
    }>;
    return clients.filter((client) => client.mapped).map((client) => ({
        address: normalizeHyprlandAddress(client.address),
        title: client.title,
        mapped: client.mapped,
        x: client.at[0],
        y: client.at[1],
        width: client.size[0],
        height: client.size[1],
    }));
}

export function normalizeHyprlandAddress(address: string): string {
    return address.replace(/^0x/, '');
}

/** Re-exported types for convenience. */
export type {AstalHyprland};
export const Hyprland = AstalHyprland;
