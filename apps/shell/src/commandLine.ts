import type Gio from 'gi://Gio?version=2.0';

/** A local launch boots once before dispatch; remote requests reuse the running UI. */
export function dispatchCommandLine(
    cmd: Pick<Gio.ApplicationCommandLine, 'isRemote' | 'get_arguments'>,
    bootstrap: () => void,
    request: () => number
): number {
    if (cmd.isRemote) return request();
    bootstrap();
    return cmd.get_arguments().length > 1 ? request() : 0;
}
