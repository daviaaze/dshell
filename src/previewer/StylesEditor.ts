/**
 * StylesEditor — CSS class editor for the previewer props panel.
 *
 * Renders: active class chips, common-class toggle grid, and a
 * custom-class entry field.
 */

import Gtk from 'gi://Gtk?version=4.0';

type ClassesAccessor = () => string[];
type ClassesSetter = (c: string[]) => void;

const COMMON_CLASSES = [
    'flat',
    'card',
    'circular',
    'raised',
    'linked',
    'destructive-action',
    'suggested-action',
    'error',
    'warning',
    'success',
    'accent',
    'title-1',
    'title-2',
    'title-3',
    'title-4',
    'heading',
    'body',
    'caption',
    'monospace',
    'dim-label',
    'osd',
    'opaque',
];

/**
 * Build the Styles panel section and append to `parent`.
 * Call this from within a `buildPropsPanel` / rebuild cycle.
 */
export function buildStylesPanel(
    parent: Gtk.Box,
    getExtraClasses: ClassesAccessor,
    setExtraClasses: ClassesSetter
) {
    const sep = new Gtk.Separator({marginTop: 8, marginBottom: 8});
    parent.append(sep);

    // ── Header with reset ──
    const hdr = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
    });
    hdr.append(
        new Gtk.Label({
            label: 'CSS Styles',
            cssClasses: ['title-4'],
            hexpand: true,
        })
    );
    const resetBtn = new Gtk.Button({
        iconName: 'edit-clear-all-symbolic',
        tooltipText: 'Clear all extra CSS classes',
        cssClasses: ['flat'],
        valign: Gtk.Align.CENTER,
    });
    resetBtn.connect('clicked', () => setExtraClasses([]));
    hdr.append(resetBtn);
    parent.append(hdr);

    // ── Active classes as flow chips ──
    const flowBox = new Gtk.FlowBox({
        maxChildrenPerLine: 3,
        minChildrenPerLine: 1,
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 4,
        rowSpacing: 4,
        marginTop: 4,
    });

    const rebuildChips = () => {
        let ch = flowBox.get_first_child();
        while (ch) {
            flowBox.remove(ch);
            ch = flowBox.get_first_child();
        }
        for (const cls of getExtraClasses()) {
            const chipRow = new Gtk.Box({spacing: 2});
            const lbl = new Gtk.Label({
                label: cls,
                cssClasses: ['caption', 'monospace'],
            });
            chipRow.append(lbl);
            const delBtn = new Gtk.Button({
                iconName: 'window-close-symbolic',
                cssClasses: ['circular', 'flat'],
                valign: Gtk.Align.CENTER,
            });
            delBtn.connect('clicked', () => {
                setExtraClasses(getExtraClasses().filter(c => c !== cls));
            });
            chipRow.append(delBtn);
            flowBox.append(chipRow);
        }
        flowBox.visible = getExtraClasses().length > 0;
    };
    flowBox.connect('map', rebuildChips);
    parent.append(flowBox);

    // ── Common class toggles (compact grid) ──
    const toggleGrid = new Gtk.FlowBox({
        maxChildrenPerLine: 3,
        minChildrenPerLine: 1,
        selectionMode: Gtk.SelectionMode.NONE,
        columnSpacing: 2,
        rowSpacing: 2,
        marginTop: 6,
    });
    for (const cls of COMMON_CLASSES) {
        const isActive = getExtraClasses().includes(cls);
        const btn = new Gtk.ToggleButton({
            label: cls,
            active: isActive,
            cssClasses: ['flat'],
            tooltipText: `Toggle .${cls}`,
        });
        btn.connect('toggled', () => {
            const current = getExtraClasses();
            if (btn.active) {
                setExtraClasses([...current, cls]);
            } else {
                setExtraClasses(current.filter(c => c !== cls));
            }
        });
        toggleGrid.append(btn);
    }
    parent.append(toggleGrid);

    // ── Custom class entry ──
    const addRow = new Gtk.Box({spacing: 4, marginTop: 6});
    const entry = new Gtk.Entry({
        placeholderText: 'custom-class',
        hexpand: true,
    });
    addRow.append(entry);
    const addBtn = new Gtk.Button({
        label: 'Add',
        cssClasses: ['suggested-action'],
    });
    addBtn.connect('clicked', () => {
        const text = entry.text.trim();
        if (text && !getExtraClasses().includes(text)) {
            setExtraClasses([...getExtraClasses(), text]);
        }
        entry.text = '';
    });
    addRow.append(addBtn);
    parent.append(addRow);
}
