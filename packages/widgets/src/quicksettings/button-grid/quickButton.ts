import type {GnimNode} from 'gnim';

/**
 * A button in the quick-settings grid. The button JSX node (virtual node) is
 * stored directly — the grid renders it declaratively via `<For>`, and the
 * actual Gtk widgets are materialized by the renderer.
 */
export interface QuickButton {
    widget: GnimNode;
}

export interface QuickDetailButton extends QuickButton {
    detail: GnimNode;
}
