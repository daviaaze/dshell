import type Gdk from 'gi://Gdk?version=4.0';

export interface XDPHWindow {
    id: string;
    clazz: string;
    title: string;
    address: string;
}

export interface HyprMonitor {
    name: string;
    description: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface HyprClient {
    address: string;
    class: string;
    title: string;
    at: [number, number];
    size: [number, number];
    mapped: boolean;
    hidden: boolean;
}

/** Shared source state — referenced by picture widgets across tabs */
export interface SourceState<S, T> {
    info: S;
    kind: T;
    /** Primary texture (shared by all Picture widgets for this source) */
    texture: Gdk.Texture | null;
    /** Whether a grim capture is currently in-flight */
    capturing: boolean;
}

export interface MonitorState extends SourceState<HyprMonitor, 'monitor'> {
    kind: 'monitor';
}

export interface WindowState extends SourceState<XDPHWindow, 'window'> {
    kind: 'window';
    geometry: {x: number; y: number; width: number; height: number} | null;
    /** Matched hyprctl client address (hex), null if unmatched */
    hyprAddress: string | null;
}

/** Callback invoked when the user picks a source — prints the XDPH selection */
export type SelectFn = (kind: 'screen' | 'window', id: string) => void;
