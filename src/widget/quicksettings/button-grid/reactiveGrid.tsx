import Gtk from 'gi://Gtk?version=4.0';
import {computed, For} from 'gnim';
import type {QuickButton} from './quickButton';

export interface ReactiveGridProps {
    cols?: number;
    items: QuickButton[];
}

/**
 * A reactive grid that reflows visible items tightly into rows.
 *
 * Uses nested Gtk.Boxes (vertical outer, horizontal per-row) instead of
 * Gtk.Grid, because JSX in gnim v2 returns virtual nodes (not widget
 * instances) and Gtk.Grid.attach() requires real widgets.  The `<For>`
 * component preserves child identity via object reference, so the same
 * QuickButton keeps its widget across reflows.
 */
export const ReactiveGrid = ({cols = 2, items}: ReactiveGridProps) => {
    const visibleItems = computed(() =>
        items.filter(item => item.visible?.() !== false)
    );

    const rows = computed(() => {
        const vis = visibleItems();
        const result: QuickButton[][] = [];
        for (let i = 0; i < vis.length; i += cols) {
            result.push(vis.slice(i, i + cols));
        }
        return result;
    });

    return (
        <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            hexpand
        >
            <For each={rows}>
                {(row) => (
                    <Gtk.Box
                        spacing={4}
                        homogeneous
                        hexpand
                    >
                        <For each={computed(() => row)}>
                            {(item: QuickButton) => item.widget}
                        </For>
                    </Gtk.Box>
                )}
            </For>
        </Gtk.Box>
    );
};
