import Gtk from 'gi://Gtk?version=4.0';
import {bind, computed, For} from 'gnim';
import type {QuickButton} from './quickButton';
import {getHyprland} from '@shade/services/hyprland';

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
const SINGLE_COLUMN_WIDTH = 600;

export const ReactiveGrid = ({cols = 2, items}: ReactiveGridProps) => {
    const visibleItems = computed(() => items.filter((item) => item.visible?.() !== false));
    const hyprland = getHyprland();
    const focusedMonitor = hyprland ? bind(hyprland, 'focused-monitor') : null;
    const columnCount = computed(() => {
        const monitor = focusedMonitor?.() ?? null;
        const logicalWidth = monitor ? monitor.width / (monitor.scale || 1) : 0;
        return logicalWidth > 0 && logicalWidth <= SINGLE_COLUMN_WIDTH ? 1 : cols;
    });
    const rows = computed(() => {
        const vis = visibleItems();
        const columns = columnCount();
        const result: QuickButton[][] = [];
        for (let i = 0; i < vis.length; i += columns) {
            result.push(vis.slice(i, i + columns));
        }
        return result;
    });

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
            <For each={rows}>
                {(row) => (
                    <Gtk.Box spacing={4} homogeneous hexpand>
                        <For each={computed(() => row)}>{(item: QuickButton) => item.widget}</For>
                    </Gtk.Box>
                )}
            </For>
        </Gtk.Box>
    );
};

