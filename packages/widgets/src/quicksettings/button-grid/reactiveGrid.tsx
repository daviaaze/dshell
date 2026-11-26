import Gtk from 'gi://Gtk?version=4.0';
import {type Accessor, computed, For} from 'gnim';
import {SURFACE_SPACING} from '../../common/surface';
import {preserveRowParents} from '../preserveRowParents';
import type {QuickButton} from './quickButton';

export interface ReactiveGridProps {
    columns: Accessor<number>;
    items: QuickButton[];
}

/**
 * Lays quick buttons out in rows of `columns`.
 *
 * Uses nested Gtk.Boxes (vertical outer, horizontal per-row) instead of
 * Gtk.Grid, because JSX in gnim v2 returns virtual nodes (not widget
 * instances) and Gtk.Grid.attach() requires real widgets. Rows are keyed by
 * their index and buttons by object identity, so a button is only rebuilt
 * when a column-count change moves it to another row.
 */
export const ReactiveGrid = ({columns, items}: ReactiveGridProps) => {
    const rowIndexes = computed(() =>
        Array.from({length: Math.ceil(items.length / columns())}, (_, row) => row)
    );

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={SURFACE_SPACING}
            hexpand
            ref={preserveRowParents}
        >
            <For each={rowIndexes}>
                {(row: number) => (
                    <Gtk.Box spacing={SURFACE_SPACING} homogeneous hexpand ref={preserveRowParents}>
                        <For
                            each={computed(() =>
                                items.slice(row * columns(), (row + 1) * columns())
                            )}
                        >
                            {(item: QuickButton) => item.widget}
                        </For>
                    </Gtk.Box>
                )}
            </For>
        </Gtk.Box>
    );
};
