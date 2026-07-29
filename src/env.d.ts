export declare global {
    interface ImportMeta {
        name: string;
        version: string;
        domain: string;
        datadir: string;
        bindir: string;
    }
}

// Missing GTop function declarations that GIR does not capture.
declare module 'gi://GTop' {
    export function glibtop_get_cpu(buffer: GI.GTop.glibtop_cpu): void;
    export function glibtop_get_mem(buffer: GI.GTop.glibtop_mem): void;
    export function glibtop_get_fsusage(
        buffer: GI.GTop.glibtop_fsusage,
        path: string
    ): void;
}

// AstalWl.WlDisplay is not included in the GIR type definitions.
declare module 'gi://AstalWl?version=0.1' {
    interface WlDisplay {
        // wayland-native display — no additional methods needed
    }
    var WlDisplay: {
        get_default(): WlDisplay;
    };
}
