import Gtk from 'gi://Gtk?version=4.0';
import type {Accessor} from 'gnim';

/**
 * A toggleable button that the quick-settings grid can dynamically hide and
 * re-layout. The widget is always instantiated; visibility is evaluated by the
 * grid so removing a button never leaves empty cells.
 */
export interface QuickButton {
    widget: Gtk.Widget;
    visible?: Accessor<boolean>;
}
