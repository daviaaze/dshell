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
