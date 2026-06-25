/**
 * IconPickerPopover — reusable icon browser popover.
 *
 * Shows a searchable grid of all 115 Adwaita icons. Singleton pattern:
 * only one popover is ever created and reused across all prop rows.
 */

import Gtk from "gi://Gtk?version=4.0"
import { IconNames } from "#/lib/iconNames"

let _iconPickerPopover: Gtk.Popover | null = null
let _iconPickerEntry: Gtk.Entry | null = null

/**
 * Get or create the singleton icon picker popover, targeting `targetEntry`.
 * The popover is reused across all icon prop rows — calling this again
 * just updates which entry receives the selected icon.
 */
export function createIconPickerPopover(
  targetEntry: Gtk.Entry,
): Gtk.Popover {
  _iconPickerEntry = targetEntry

  // De-dupe: reuse the same popover
  if (_iconPickerPopover) return _iconPickerPopover

  const popover = new Gtk.Popover({ hasArrow: false })
  _iconPickerPopover = popover

  const outerBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    marginStart: 8,
    marginEnd: 8,
    marginTop: 8,
    marginBottom: 8,
  })

  const searchEntry = new Gtk.SearchEntry({
    placeholderText: "Search icons…",
    marginBottom: 4,
  })
  outerBox.append(searchEntry)

  const scroller = new Gtk.ScrolledWindow({
    minContentHeight: 240,
    maxContentHeight: 360,
  })
  const flowBox = new Gtk.FlowBox({
    maxChildrenPerLine: 6,
    minChildrenPerLine: 4,
    selectionMode: Gtk.SelectionMode.NONE,
    homogeneous: true,
    columnSpacing: 4,
    rowSpacing: 4,
  })

  const iconEntries = Object.entries(IconNames) as [string, string][]
  const buttons: Gtk.Button[] = []

  for (const [tsName, iconStr] of iconEntries) {
    const btn = new Gtk.Button({
      cssClasses: ["flat", "circular"],
      tooltipText: `${tsName}\n${iconStr}`,
    })
    const img = new Gtk.Image({ iconName: iconStr, pixelSize: 20 })
    btn.set_child(img)
    btn.connect("clicked", () => {
      if (_iconPickerEntry) _iconPickerEntry.text = iconStr
      popover.popdown()
    })
    flowBox.append(btn)
    buttons.push(btn)
  }

  searchEntry.connect("search-changed", () => {
    const q = searchEntry.text.toLowerCase()
    for (let i = 0; i < buttons.length; i++) {
      const [tsName, iconStr] = iconEntries[i] ?? ["", ""]
      buttons[i].visible =
        q === "" ||
        tsName.toLowerCase().includes(q) ||
        iconStr.toLowerCase().includes(q)
    }
  })

  scroller.set_child(flowBox)
  outerBox.append(scroller)
  popover.set_child(outerBox)

  return popover
}
