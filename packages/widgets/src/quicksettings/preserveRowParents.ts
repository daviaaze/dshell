import type GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import {setChildren} from 'gnim';

/** Reconcile a live list without unparenting retained rows and losing focus/popovers. */
export function preserveRowParents(box: Gtk.Box): void {
    Object.assign(box, {
        [setChildren](children: GObject.Object[], previous: GObject.Object[]): boolean {
            for (const child of previous) {
                if (child instanceof Gtk.Widget && !children.includes(child)) box.remove(child);
            }

            let sibling: Gtk.Widget | null = null;
            for (const child of children) {
                if (!(child instanceof Gtk.Widget)) continue;
                if (child.get_parent() !== box) {
                    box.insert_child_after(child, sibling);
                } else if (child.get_prev_sibling() !== sibling) {
                    box.reorder_child_after(child, sibling);
                }
                sibling = child;
            }
            return true;
        },
    });
}
