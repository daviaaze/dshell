declare module 'gi://GLibUnix?version=2.0' {
    export function signal_add_full(
        priority: number,
        sig: number,
        handler: () => boolean
    ): number;

    export function signal_add(sig: number, handler: () => boolean): number;

    const GLibUnix: {
        signal_add_full: typeof signal_add_full;
        signal_add: typeof signal_add;
    };
    export default GLibUnix;
}
