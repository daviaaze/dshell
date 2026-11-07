import type Notifd from 'gi://AstalNotifd';
import GLib from 'gi://GLib?version=2.0';
import {type Accessor, createState, effect, onCleanup} from 'gnim';
import {getNotifdSafe, isNotifdResolved, watchNotifdInit} from './guard';

export interface NotifdResource {
    value: Accessor<Notifd.Notifd | null>;
    resolved: Accessor<boolean>;
}

/** A null value is unavailable only after resolution; pending is a separate state. */
export function useNotifd(): NotifdResource {
    const initialized = isNotifdResolved();
    const [value, setValue] = createState<Notifd.Notifd | null>(initialized ? getNotifdSafe() : null);
    const [resolved, setResolved] = createState(initialized);
    if (!initialized) effect(() => {
        let done = false;
        let source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            source = 0;
            setValue(getNotifdSafe());
            setResolved(true);
            done = true;
            return GLib.SOURCE_REMOVE;
        });
        watchNotifdInit(() => done);
        onCleanup(() => {
            done = true;
            if (source) GLib.source_remove(source);
        });
    });
    return {value, resolved};
}
