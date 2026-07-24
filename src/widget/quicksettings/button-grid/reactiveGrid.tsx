import Gtk from 'gi://Gtk?version=4.0';
import {createComputed, createEffect} from 'gnim';
import type {QuickButton} from './quickButton';

function removeAllChildren(grid: Gtk.Grid) {
    // Gtk.Grid has no remove_all(); detach every child from the first one
    // until the container is empty.
    for (let child = grid.get_first_child(); child; child = grid.get_first_child()) {
        grid.remove(child);
    }
}

export interface ReactiveGridProps {
    cols?: number;
    items: QuickButton[];
}

/**
 * A Gtk.Grid that recomputes the layout whenever a QuickButton's `visible`
 * accessor changes, removing hidden children and packing the remaining ones
 * tightly in row-major order.
 */
export const ReactiveGrid = ({cols = 2, items}: ReactiveGridProps) => {
    const visibleItems = createComputed(() =>
        items
            .filter(item => item.visible?.() !== false)
            .map(item => item.widget)
    );

    return (
        <Gtk.Grid
            rowSpacing={4}
            columnSpacing={4}
            columnHomogeneous
            hexpand
            $={self =>
                createEffect(() => {
                    removeAllChildren(self);
                    visibleItems().forEach((widget, index) => {
                        self.attach(
                            widget,
                            index % cols,
                            Math.floor(index / cols),
                            1,
                            1
                        );
                    });
                })
            }
        />
    );
};
