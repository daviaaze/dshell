/**
 * Sidebar — component list with search and category headers.
 *
 * Renders the left sidebar of the previewer: a searchable list of
 * registered components grouped by category. Notifies the parent
 * when the user selects a component.
 */

import Gtk from 'gi://Gtk?version=4.0';
import {entries, type ComponentEntry} from './registry';

interface EntryRow {
    label: Gtk.Label;
    index: number;
}

export interface SidebarCallbacks {
    /** Called when the user selects a component from the list */
    onSelect: (entry: ComponentEntry) => void;
    /** Optional: current component accessor for external selection sync */
    current?: () => ComponentEntry;
}

/**
 * Build the sidebar widget.
 *
 * @param initialIndex  Index of the initially-selected component
 * @param callbacks     Selection callback + optional sync accessor
 * @returns             The fully-built sidebar Gtk.Box
 */
export function buildSidebar(
    initialIndex: number,
    callbacks: SidebarCallbacks
): Gtk.Box {
    const entryRows: EntryRow[] = [];

    const sidebar = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        widthRequest: 200,
        cssClasses: ['preview-sidebar'],
    });

    const searchEntry = new Gtk.SearchEntry({
        placeholderText: 'Search…',
        marginStart: 8,
        marginEnd: 8,
        marginTop: 8,
        marginBottom: 4,
    });
    sidebar.append(searchEntry);

    const sidebarScroller = new Gtk.ScrolledWindow({vexpand: true});
    const listBox = new Gtk.ListBox({
        cssClasses: ['preview-listbox'],
        activateOnSingleClick: true,
    });

    // Build list with category headers between groups
    let lastCategory = '';
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        if (entry.category !== lastCategory) {
            lastCategory = entry.category;
            const catRow = new Gtk.ListBoxRow({
                selectable: false,
                activatable: false,
                focusable: false,
            });
            const catLabel = new Gtk.Label({
                label: entry.category.toUpperCase(),
                cssClasses: ['caption', 'preview-category-label'],
                marginStart: 12,
                marginTop: 8,
                marginBottom: 2,
                halign: Gtk.Align.START,
            });
            catRow.set_child(catLabel);
            listBox.append(catRow);
        }

        const rowLabel = new Gtk.Label({
            label: entry.name,
            halign: Gtk.Align.START,
            hexpand: true,
            cssClasses: ['preview-list-item'],
            marginStart: 12,
            marginTop: 4,
            marginBottom: 4,
        });
        listBox.append(rowLabel);
        entryRows.push({label: rowLabel, index: i});
    }

    // Filter entry rows by search query
    searchEntry.connect('search-changed', () => {
        const q = searchEntry.text.toLowerCase();
        for (const r of entryRows) {
            r.label.visible =
                q === '' || entries[r.index].name.toLowerCase().includes(q);
        }
    });

    // Select entry from activated row
    listBox.connect('row-activated', (_lb, row) => {
        const child = row.get_first_child();
        if (!child) return;
        const found = entryRows.find(r => r.label === child);
        if (found && entries[found.index]) {
            callbacks.onSelect(entries[found.index]);
        }
    });

    // Initial selection
    if (initialIndex >= 0 && initialIndex < entries.length) {
        const row = listBox.get_row_at_index(initialIndex);
        if (row) listBox.select_row(row);
    }

    // Sync selection highlight when current() changes externally
    if (callbacks.current) {
        callbacks.current.subscribe(c => {
            const idx = entries.indexOf(c);
            if (idx < 0) return;
            const target = entryRows.find(r => r.index === idx);
            if (!target) return;
            let row = listBox.get_first_child();
            while (row) {
                if (
                    (row as Gtk.ListBoxRow).get_first_child() === target.label
                ) {
                    listBox.select_row(row as Gtk.ListBoxRow);
                    return;
                }
                row = row.get_next_sibling();
            }
        });
    }

    sidebarScroller.set_child(listBox);
    sidebar.append(sidebarScroller);

    return sidebar;
}
