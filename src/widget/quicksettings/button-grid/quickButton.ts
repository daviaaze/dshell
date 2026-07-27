import type {Accessor, GnimNode} from 'gnim';

/**
 * A toggleable button that the quick-settings grid can dynamically hide and
 * re-layout. The button JSX node (virtual node) is stored directly — the
 * grid renders it declaratively via `<For>`, and the actual Gtk widgets
 * are materialized by the renderer.
 */
export interface QuickButton {
    widget: GnimNode;
    visible?: Accessor<boolean>;
}
