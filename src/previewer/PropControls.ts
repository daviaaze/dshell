/**
 * PropControls — factory functions for building editable prop rows.
 *
 * Each function returns a Gtk.Box (label + control) for one prop type.
 * Used by PropsEditor to build the scrolled props panel.
 */

import Gtk from "gi://Gtk?version=4.0"
import { type PropDef } from "./registry"
import { createIconPickerPopover } from "./IconPickerPopover"

type PropsAccessor = () => Record<string, unknown>
type PropsSetter = (p: Record<string, unknown>) => void

function buildLabel(def: PropDef): Gtk.Label {
  return new Gtk.Label({
    label: def.label,
    cssClasses: ["caption"],
    halign: Gtk.Align.START,
    hexpand: true,
  })
}

function buildBooleanRow(
  key: string,
  def: PropDef,
  getProps: PropsAccessor,
  setProps: PropsSetter,
): Gtk.Box {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  row.append(buildLabel(def))

  const sw = new Gtk.Switch({
    active: (getProps()[key] as boolean) ?? false,
    valign: Gtk.Align.CENTER,
  })
  sw.connect("notify::active", () => {
    const next = { ...getProps() }
    next[key] = sw.active
    setProps(next)
  })
  row.append(sw)
  return row
}

function buildStringRow(
  key: string,
  def: PropDef,
  getProps: PropsAccessor,
  setProps: PropsSetter,
): Gtk.Box {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  row.append(buildLabel(def))

  const entryWidget = new Gtk.Entry({
    text: (getProps()[key] as string) ?? (def.default as string) ?? "",
    hexpand: true,
  })
  entryWidget.connect("notify::text", () => {
    const next = { ...getProps() }
    next[key] = entryWidget.text
    setProps(next)
  })
  row.append(entryWidget)
  return row
}

function buildNumberRow(
  key: string,
  def: PropDef,
  getProps: PropsAccessor,
  setProps: PropsSetter,
): Gtk.Box {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  row.append(buildLabel(def))

  const rawVal = (getProps()[key] as number) ?? (def.default as number) ?? 0
  const currentVal = Number.isFinite(rawVal) ? rawVal : 0
  const adj = new Gtk.Adjustment({
    value: currentVal,
    lower: def.min ?? 0,
    upper: def.max ?? 100,
    stepIncrement: def.step ?? 1,
  })
  const spin = new Gtk.SpinButton({
    adjustment: adj,
    numeric: true,
    widthChars: 5,
    valign: Gtk.Align.CENTER,
  })
  spin.connect("value-changed", () => {
    const next = { ...getProps() }
    next[key] = spin.get_value()
    setProps(next)
  })
  row.append(spin)
  return row
}

function buildSelectRow(
  key: string,
  def: PropDef,
  getProps: PropsAccessor,
  setProps: PropsSetter,
): Gtk.Box {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  row.append(buildLabel(def))

  const options = def.options ?? []
  const model = new Gtk.StringList({ strings: options })
  const currentVal =
    (getProps()[key] as string) ?? (def.default as string) ?? options[0] ?? ""
  const selectedIdx = options.indexOf(currentVal)
  const dd = new Gtk.DropDown({
    model,
    selected: Math.max(0, selectedIdx),
    valign: Gtk.Align.CENTER,
  })
  dd.connect("notify::selected", () => {
    const idx = dd.selected
    if (idx >= 0 && idx < options.length) {
      const next = { ...getProps() }
      next[key] = options[idx]
      setProps(next)
    }
  })
  row.append(dd)
  return row
}

function buildIconRow(
  key: string,
  def: PropDef,
  getProps: PropsAccessor,
  setProps: PropsSetter,
): Gtk.Box {
  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  row.append(buildLabel(def))

  const currentIcon =
    (getProps()[key] as string) ?? (def.default as string) ?? ""
  const entryWidget = new Gtk.Entry({
    text: currentIcon,
    hexpand: true,
  })
  entryWidget.connect("notify::text", () => {
    const next = { ...getProps() }
    next[key] = entryWidget.text
    setProps(next)
  })
  row.append(entryWidget)

  const browseBtn = new Gtk.Button({
    label: "…",
    cssClasses: ["flat", "circular"],
    tooltipText: "Browse icons",
    valign: Gtk.Align.CENTER,
  })

  // Lazy popover — created once via singleton
  let popover: Gtk.Popover | null = null
  browseBtn.connect("clicked", () => {
    if (!popover) {
      popover = createIconPickerPopover(entryWidget)
      popover.set_parent(browseBtn)
    }
    popover.popup()
  })

  row.append(browseBtn)
  return row
}

/** Dispatch table mapping PropDef.type → row builder */
export const propBuilders: Record<
  string,
  (key: string, def: PropDef, get: PropsAccessor, set: PropsSetter) => Gtk.Box
> = {
  boolean: buildBooleanRow,
  string: buildStringRow,
  number: buildNumberRow,
  select: buildSelectRow,
  icon: buildIconRow,
}
