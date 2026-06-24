/**
 * PreviewWindow — sidebar + preview area.
 *
 * Uses createEffect to render components inside a Gnim Scope, so that
 * For, onCleanup, and other scope-dependent features work correctly.
 */

import Gtk from "gi://Gtk?version=4.0"
import Adw from "gi://Adw?version=1"
import { createEffect, createState, createBinding } from "gnim"
import { IconNames } from "#/lib/iconNames"
import {
  entries,
  findEntry,
  type ComponentEntry,
  type PropDef,
} from "./registry"

interface PreviewWindowProps {
  initialComponent?: string
}

export const PreviewWindow = (props: PreviewWindowProps) => {
  const initial = props.initialComponent
    ? findEntry(props.initialComponent) ?? entries[0]
    : entries[0]

  const [current, setCurrent] = createState(initial ?? entries[0])
  const [propsState, setPropsState] = createState<Record<string, unknown>>(
    initial?.defaultProps ?? {},
  )
  let panelVisible = true
  let panelBox: Gtk.Box | null = null
  let panelSep: Gtk.Separator | null = null

  // ── viewport / background state ──────────────────────────────────────
  const SIZES = [
    { label: "Fill", value: -1 },
    { label: "S", value: 320, tooltip: "320px" },
    { label: "M", value: 768, tooltip: "768px" },
    { label: "L", value: 1024, tooltip: "1024px" },
    { label: "XL", value: 1920, tooltip: "1920px" },
  ]
  const [viewportW, setViewportW] = createState(-1)
  const [bgMode, setBgMode] = createState("default")
  const [extraClasses, setExtraClasses] = createState<string[]>([])
  const isDark = createBinding(Adw.StyleManager.get_default(), "dark")

  // ════════════════════════════ SIDEBAR ════════════════════════════
  // Only entry rows (not category headers) for index-based lookup
  interface EntryRow {
    label: Gtk.Label
    index: number
  }
  const entryRows: EntryRow[] = []

  const sidebar = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    widthRequest: 200,
    cssClasses: ["preview-sidebar"],
  })

  const searchEntry = new Gtk.SearchEntry({
    placeholderText: "Search…",
    marginStart: 8,
    marginEnd: 8,
    marginTop: 8,
    marginBottom: 4,
  })
  sidebar.append(searchEntry)

  const sidebarScroller = new Gtk.ScrolledWindow({ vexpand: true })
  const listBox = new Gtk.ListBox({
    cssClasses: ["preview-listbox"],
    activateOnSingleClick: true,
  })

  // Build list with category headers between groups
  let lastCategory = ""
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Insert category header when group changes
    if (entry.category !== lastCategory) {
      lastCategory = entry.category
      const catRow = new Gtk.ListBoxRow({
        selectable: false,
        activatable: false,
        focusable: false,
      })
      const catLabel = new Gtk.Label({
        label: entry.category.toUpperCase(),
        cssClasses: ["caption", "preview-category-label"],
        marginStart: 12,
        marginTop: 8,
        marginBottom: 2,
        halign: Gtk.Align.START,
      })
      catRow.set_child(catLabel)
      listBox.append(catRow)
    }

    const rowLabel = new Gtk.Label({
      label: entry.name,
      halign: Gtk.Align.START,
      hexpand: true,
      cssClasses: ["preview-list-item"],
      marginStart: 12,
      marginTop: 4,
      marginBottom: 4,
    })
    listBox.append(rowLabel)
    entryRows.push({ label: rowLabel, index: i })
  }

  // Filter entry rows by search query
  searchEntry.connect("search-changed", () => {
    const q = searchEntry.text.toLowerCase()
    for (const r of entryRows) {
      r.label.visible = q === "" || entries[r.index].name.toLowerCase().includes(q)
    }
  })

  // Select entry from activated row
  const selectEntry = (row: Gtk.ListBoxRow) => {
    const child = row.get_first_child()
    if (!child) return
    const found = entryRows.find((r) => r.label === child)
    if (found && entries[found.index]) {
      setCurrent(entries[found.index])
      setPropsState({ ...entries[found.index].defaultProps })
    }
  }

  const initialIdx = entries.indexOf(initial ?? entries[0])
  if (initialIdx >= 0) {
    const row = listBox.get_row_at_index(initialIdx)
    if (row) listBox.select_row(row)
  }

  listBox.connect("row-activated", (_lb, row) => selectEntry(row))

  // Sync selection highlight when current() changes externally
  current.subscribe((c) => {
    const idx = entries.indexOf(c)
    if (idx < 0) return
    const target = entryRows.find((r) => r.index === idx)
    if (!target) return
    let row = listBox.get_first_child()
    while (row) {
      if ((row as Gtk.ListBoxRow).get_first_child() === target.label) {
        listBox.select_row(row as Gtk.ListBoxRow)
        return
      }
      row = row.get_next_sibling()
    }
  })

  sidebarScroller.set_child(listBox)
  sidebar.append(sidebarScroller)

  // ════════════════════════ PROPS PANEL ════════════════════════
  const propsPanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    widthRequest: 220,
    cssClasses: ["preview-props-editor"],
  })

  // ── icon picker popover ────────────────────────────────────────────
  let _iconPickerPopover: Gtk.Popover | null = null
  let _iconPickerEntry: Gtk.Entry | null = null

  const buildIconPopup = (
    targetEntry: Gtk.Entry,
    parentWidget: Gtk.Widget,
  ): Gtk.Popover => {
    // De-dupe: reuse the same popover
    if (_iconPickerPopover) {
      _iconPickerEntry = targetEntry
      return _iconPickerPopover
    }
    _iconPickerEntry = targetEntry

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

    // Store icon entries for filtering
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

  // ── build / rebuild the editable props panel ───────────────────────
  let _buildingPanel = false

  const buildPropsPanel = () => {
    // Prevent recursive rebuilds (e.g., ToggleButton toggled during construction)
    if (_buildingPanel) return
    _buildingPanel = true
    // Clear
    let c = propsPanel.get_first_child()
    while (c) {
      propsPanel.remove(c)
      c = propsPanel.get_first_child()
    }

    const entry = current()
    const eProps = entry?.editableProps ? Object.entries(entry.editableProps) : []

    // ── Scrollable controls ──
    const scroller = new Gtk.ScrolledWindow({ vexpand: true })
    const inner = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      marginStart: 8,
      marginEnd: 8,
      marginTop: 4,
      marginBottom: 8,
    })

    // Styles section FIRST (always visible, even without editableProps)
    buildStylesPanel(inner)

    if (eProps.length === 0) {
      scroller.set_child(inner)
      propsPanel.append(scroller)
      _buildingPanel = false
      return
    }

    // ── Header: title + reset button ──
    const headerBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 4,
      marginTop: 8,
      marginBottom: 4,
      marginStart: 8,
      marginEnd: 8,
    })
    const title = new Gtk.Label({
      label: "Props",
      cssClasses: ["title-4"],
      hexpand: true,
    })
    const resetBtn = new Gtk.Button({
      iconName: "edit-clear-all-symbolic",
      tooltipText: "Reset to defaults",
      cssClasses: ["flat"],
      valign: Gtk.Align.CENTER,
    })
    resetBtn.connect("clicked", () => {
      setPropsState({ ...entry.defaultProps })
    })
    headerBox.append(title)
    headerBox.append(resetBtn)
    propsPanel.append(headerBox)

    // Styles section FIRST (always visible at top of panel)
    buildStylesPanel(inner)

    if (eProps.length > 0) {
      inner.append(
        new Gtk.Separator({ marginTop: 4, marginBottom: 4 }),
      )
    }

    for (const [key, def] of eProps) {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        hexpand: true,
      })

      const lbl = new Gtk.Label({
        label: def.label,
        cssClasses: ["caption"],
        halign: Gtk.Align.START,
        hexpand: true,
      })
      row.append(lbl)

      if (def.type === "boolean") {
        const sw = new Gtk.Switch({
          active: (propsState()[key] as boolean) ?? false,
          valign: Gtk.Align.CENTER,
        })
        sw.connect("notify::active", () => {
          const next = { ...propsState() }
          next[key] = sw.active
          setPropsState(next)
        })
        row.append(sw)
      } else if (def.type === "string") {
        const entryWidget = new Gtk.Entry({
          text: (propsState()[key] as string) ?? (def.default as string) ?? "",
          hexpand: true,
        })
        entryWidget.connect("notify::text", () => {
          const next = { ...propsState() }
          next[key] = entryWidget.text
          setPropsState(next)
        })
        row.append(entryWidget)
      } else if (def.type === "number") {
        const rawVal =
          (propsState()[key] as number) ?? (def.default as number) ?? 0
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
          const next = { ...propsState() }
          next[key] = spin.get_value()
          setPropsState(next)
        })
        row.append(spin)
      } else if (def.type === "select") {
        const options = def.options ?? []
        const model = new Gtk.StringList({ strings: options })
        const currentVal =
          (propsState()[key] as string) ??
          (def.default as string) ??
          options[0] ??
          ""
        const selectedIdx = options.indexOf(currentVal)
        const dd = new Gtk.DropDown({
          model,
          selected: Math.max(0, selectedIdx),
          valign: Gtk.Align.CENTER,
        })
        dd.connect("notify::selected", () => {
          const idx = dd.selected
          if (idx >= 0 && idx < options.length) {
            const next = { ...propsState() }
            next[key] = options[idx]
            setPropsState(next)
          }
        })
        row.append(dd)
      } else if (def.type === "icon") {
        const currentIcon =
          (propsState()[key] as string) ?? (def.default as string) ?? ""
        const entryWidget = new Gtk.Entry({
          text: currentIcon,
          hexpand: true,
        })
        entryWidget.connect("notify::text", () => {
          const next = { ...propsState() }
          next[key] = entryWidget.text
          setPropsState(next)
        })
        row.append(entryWidget)

        const browseBtn = new Gtk.Button({
          label: "…",
          cssClasses: ["flat", "circular"],
          tooltipText: "Browse icons",
          valign: Gtk.Align.CENTER,
        })

        // Lazy popover — created once
        let popover: Gtk.Popover | null = null
        browseBtn.connect("clicked", () => {
          if (!popover) {
            popover = buildIconPopup(entryWidget, browseBtn)
            popover.set_parent(browseBtn)
          }
          _iconPickerEntry = entryWidget
          popover.popup()
        })

        row.append(browseBtn)
      }

      inner.append(row)
    }

    scroller.set_child(inner)
    propsPanel.append(scroller)
    _buildingPanel = false
  }

  // ── CSS class editor ────────────────────────────────────────────────
  const COMMON_CLASSES = [
    "flat",
    "card",
    "circular",
    "raised",
    "linked",
    "destructive-action",
    "suggested-action",
    "error",
    "warning",
    "success",
    "accent",
    "title-1",
    "title-2",
    "title-3",
    "title-4",
    "heading",
    "body",
    "caption",
    "monospace",
    "dim-label",
    "osd",
    "opaque",
  ]

  const buildStylesPanel = (inner: Gtk.Box) => {
    const sep = new Gtk.Separator({ marginTop: 8, marginBottom: 8 })
    inner.append(sep)

    // Header with reset
    const hdr = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 4,
    })
    hdr.append(
      new Gtk.Label({ label: "CSS Styles", cssClasses: ["title-4"], hexpand: true }),
    )
    const resetBtn = new Gtk.Button({
      iconName: "edit-clear-all-symbolic",
      tooltipText: "Clear all extra CSS classes",
      cssClasses: ["flat"],
      valign: Gtk.Align.CENTER,
    })
    resetBtn.connect("clicked", () => setExtraClasses([]))
    hdr.append(resetBtn)
    inner.append(hdr)

    // Active classes as flow chips
    const flowBox = new Gtk.FlowBox({
      maxChildrenPerLine: 3,
      minChildrenPerLine: 1,
      selectionMode: Gtk.SelectionMode.NONE,
      columnSpacing: 4,
      rowSpacing: 4,
      marginTop: 4,
    })
    const rebuildChips = () => {
      // Clear
      let ch = flowBox.get_first_child()
      while (ch) {
        flowBox.remove(ch)
        ch = flowBox.get_first_child()
      }
      for (const cls of extraClasses()) {
        const chipRow = new Gtk.Box({ spacing: 2 })
        const lbl = new Gtk.Label({
          label: cls,
          cssClasses: ["caption", "monospace"],
        })
        chipRow.append(lbl)
        const delBtn = new Gtk.Button({
          iconName: "window-close-symbolic",
          cssClasses: ["circular", "flat"],
          valign: Gtk.Align.CENTER,
        })
        delBtn.connect("clicked", () => {
          setExtraClasses(extraClasses().filter((c) => c !== cls))
        })
        chipRow.append(delBtn)
        flowBox.append(chipRow)
      }
      flowBox.visible = extraClasses().length > 0
    }
    flowBox.connect("map", rebuildChips)
    // Also rebuild on extraClasses changes via the panel rebuild cycle
    inner.append(flowBox)

    // Common class toggles (compact grid)
    const toggleGrid = new Gtk.FlowBox({
      maxChildrenPerLine: 3,
      minChildrenPerLine: 1,
      selectionMode: Gtk.SelectionMode.NONE,
      columnSpacing: 2,
      rowSpacing: 2,
      marginTop: 6,
    })
    for (const cls of COMMON_CLASSES) {
      const isActive = extraClasses().includes(cls)
      const btn = new Gtk.ToggleButton({
        label: cls,
        active: isActive,
        cssClasses: ["flat"],
        tooltipText: `Toggle .${cls}`,
      })
      btn.connect("toggled", () => {
        const current = extraClasses()
        if (btn.active) {
          setExtraClasses([...current, cls])
        } else {
          setExtraClasses(current.filter((c) => c !== cls))
        }
      })
      toggleGrid.append(btn)
    }
    inner.append(toggleGrid)

    // Custom class entry
    const addRow = new Gtk.Box({ spacing: 4, marginTop: 6 })
    const entry = new Gtk.Entry({
      placeholderText: "custom-class",
      hexpand: true,
    })
    addRow.append(entry)
    const addBtn = new Gtk.Button({
      label: "Add",
      cssClasses: ["suggested-action"],
    })
    addBtn.connect("clicked", () => {
      const text = entry.text.trim()
      if (text && !extraClasses().includes(text)) {
        setExtraClasses([...extraClasses(), text])
      }
      entry.text = ""
    })
    addRow.append(addBtn)
    inner.append(addRow)
  }

  // ════════════════════════ REACTIVE RENDER ════════════════════════
  // We use createEffect to render the current component inside a Gnim
  // Scope. This ensures that For, onCleanup, and other scope-dependent
  // features work correctly.
  //
  // The effect tracks current() and propsState() as dependencies.
  // When either changes, the effect re-runs inside a FRESH scope,
  // disposing the old one (cleanups run, old widget is disconnected).
  let previewSlot: Gtk.Box | null = null

  createEffect(() => {
    const c = current()
    const p = propsState()
    const xClasses = extraClasses()

    // Check if the slot is available (mounted)
    if (!previewSlot) return

    // Replace the old child with the new widget
    const old = previewSlot.get_first_child()
    if (old) previewSlot.remove(old)

    // Try to render — show an error message on failure
    try {
      const widget = c.render(p)
      if (widget instanceof Gtk.Widget) {
        // Apply extra CSS classes from the Styles editor
        for (const cls of xClasses) {
          widget.add_css_class(cls)
        }
        previewSlot.append(widget)
      }
    } catch (err) {
      print("[previewer] render error:", c.name, err)
      const errBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
      })
      errBox.append(
        new Gtk.Label({
          label: "⚠️ Component Error",
          cssClasses: ["title-3", "error"],
        }),
      )
      errBox.append(
        new Gtk.Label({
          label: String(err),
          cssClasses: ["dim-label", "monospace"],
          wrap: true,
          maxWidthChars: 60,
          halign: Gtk.Align.CENTER,
        }),
      )
      previewSlot.append(errBox)
    }
  })

  // ════════════════════════ JSX LAYOUT ════════════════════════
  return (
    <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} hexpand vexpand>
      {/* Sidebar */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        widthRequest={200}
        cssClasses={["preview-sidebar"]}
        $={(self) => self.append(sidebar)}
      />

      <Gtk.Separator />

      {/* Content */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand vexpand>
        {/* Header */}
        <Gtk.Box spacing={8} marginStart={12} marginEnd={12} marginTop={8} marginBottom={8}>
          <Gtk.Label
            label={current().name}
            cssClasses={["title-3"]}
            hexpand
          />
          <Gtk.Label
            label={current().description}
            cssClasses={["caption", "dim-label"]}
          />

          {/* Preset selector — hidden when no presets */}
          <Gtk.Box
            spacing={4}
            $={(self) => {
              let presetModel: Gtk.StringList | null = null
              let presetDropDown: Gtk.DropDown | null = null

              const rebuild = () => {
                const entry = current()
                const hasPresets = !!(entry.presets && entry.presets.length > 0)
                self.visible = hasPresets
                if (!hasPresets) return

                // Build the list: "Default" + preset names
                const names = ["Default", ...entry.presets!.map((p) => p.name)]
                if (!presetModel) {
                  presetModel = new Gtk.StringList({ strings: names })
                  presetDropDown = new Gtk.DropDown({
                    model: presetModel,
                    selected: 0,
                    valign: Gtk.Align.CENTER,
                  })
                  presetDropDown.connect("notify::selected", () => {
                    const idx = presetDropDown!.selected
                    const entry = current()
                    if (idx === 0) {
                      // "Default" → reset to defaultProps
                      setPropsState({ ...entry.defaultProps })
                    } else if (entry.presets && idx - 1 < entry.presets.length) {
                      setPropsState({ ...entry.presets[idx - 1].props })
                    }
                  })
                  self.append(presetDropDown)
                } else {
                  // Update model in place
                  while (presetModel.get_n_items() > 0) {
                    presetModel.remove(0)
                  }
                  for (const n of names) {
                    presetModel.append(n)
                  }
                  presetDropDown!.selected = 0
                }
              }

              current.subscribe(rebuild)
              rebuild()
            }}
          />

          <Gtk.Button
            iconName={isDark.as((v) =>
              v ? "weather-clear-symbolic" : "weather-clear-night-symbolic",
            )}
            tooltipText={isDark.as((v) =>
              v ? "Switch to light theme" : "Switch to dark theme",
            )}
            cssClasses={["flat"]}
            onClicked={() => {
              const mgr = Adw.StyleManager.get_default()
              mgr.colorScheme =
                mgr.colorScheme === Adw.ColorScheme.FORCE_DARK
                  ? Adw.ColorScheme.FORCE_LIGHT
                  : Adw.ColorScheme.FORCE_DARK
            }}
          />
          <Gtk.Button
            iconName="document-edit-symbolic"
            tooltipText="Toggle props editor"
            cssClasses={["flat"]}
            $={(self) => {
              self.connect("clicked", () => {
                panelVisible = !panelVisible
                if (panelBox) panelBox.visible = panelVisible
                if (panelSep) panelSep.visible = panelVisible
                if (panelVisible) buildPropsPanel()
              })
            }}
          />
        </Gtk.Box>

        <Gtk.Separator />

        {/* Toolbar — size presets + background */}
        <Gtk.Box
          spacing={6}
          marginStart={12}
          marginEnd={12}
          marginTop={6}
          marginBottom={6}
        >
          <Gtk.Label label="Size:" cssClasses={["caption"]} valign={Gtk.Align.CENTER} />
          <Gtk.Box
            spacing={2}
            hexpand
            $={(self) => {
              const buttons: Gtk.ToggleButton[] = []
              for (const sz of SIZES) {
                const btn = new Gtk.ToggleButton({
                  label: sz.label,
                  active: viewportW() === sz.value,
                  tooltipText: sz.tooltip ?? sz.label,
                  cssClasses: ["flat"],
                })
                btn.connect("toggled", () => {
                  if (btn.active) {
                    buttons.forEach((b) => {
                      if (b !== btn) b.active = false
                    })
                    setViewportW(sz.value)
                  }
                })
                self.append(btn)
                buttons.push(btn)
              }
              // Sync buttons when viewportW changes externally
              viewportW.subscribe((w) => {
                for (let i = 0; i < buttons.length; i++) {
                  buttons[i].active = SIZES[i].value === w
                }
              })
            }}
          />
          <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />
          <Gtk.Label label="BG:" cssClasses={["caption"]} valign={Gtk.Align.CENTER} />
          <Gtk.DropDown
            model={new Gtk.StringList({
              strings: ["Default", "Checkerboard", "Light", "Dark"],
            })}
            selected={0}
            $={(self) => {
              self.connect("notify::selected", () => {
                const modes = ["default", "checkerboard", "light", "dark"]
                setBgMode(modes[self.selected] ?? "default")
              })
            }}
          />
        </Gtk.Box>

        <Gtk.Separator />

        {/* Preview canvas */}
        <Gtk.ScrolledWindow
          hexpand
          vexpand
          cssClasses={["preview-canvas"]}
          $={(self) => {
            // Background: toggle CSS classes on the full canvas area
            bgMode.subscribe((m) => {
              for (const cls of [
                "preview-bg-checker",
                "preview-bg-light",
                "preview-bg-dark",
              ]) {
                self.remove_css_class(cls)
              }
              if (m === "checkerboard")
                self.add_css_class("preview-bg-checker")
              else if (m === "light")
                self.add_css_class("preview-bg-light")
              else if (m === "dark")
                self.add_css_class("preview-bg-dark")
            })
          }}
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            spacing={16}
            marginStart={48}
            marginEnd={48}
            marginTop={48}
            marginBottom={48}
          >
            {/* Wrapper Box with fixed width + overflow:hidden acts as max-width */}
            <Gtk.Box
              orientation={Gtk.Orientation.VERTICAL}
              $={(self) => {
                viewportW.subscribe((w) => {
                  if (w > 0) {
                    self.widthRequest = w
                    self.overflow = Gtk.Overflow.HIDDEN
                  } else {
                    self.widthRequest = -1
                    self.overflow = Gtk.Overflow.VISIBLE
                  }
                })
              }}
            >
            <Gtk.Frame cssClasses={["card", "preview-frame"]}>
              <Gtk.Box
                marginStart={24}
                marginEnd={24}
                marginTop={24}
                marginBottom={24}
                halign={Gtk.Align.CENTER}
                valign={Gtk.Align.CENTER}
                hexpand
                vexpand
                $={(self) => {
                  previewSlot = self
                }}
              />
            </Gtk.Frame>
          </Gtk.Box>
        </Gtk.Box>
        </Gtk.ScrolledWindow>

        {/* Status bar */}
        <Gtk.Box
          spacing={8}
          marginStart={12}
          marginEnd={12}
          marginTop={4}
          marginBottom={4}
        >
          <Gtk.Label
            cssClasses={["caption", "dim-label"]}
            hexpand
            $={(self) => {
              const update = () => {
                const w = viewportW()
                const sizeText = w > 0 ? `${w}px × auto` : "Fill"
                self.label = `${current().name}  ·  ${sizeText}`
              }
              viewportW.subscribe(update)
              current.subscribe(update)
              update()
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Props panel */}
      <Gtk.Separator
        orientation={Gtk.Orientation.VERTICAL}
        $={(self) => {
          panelSep = self
          self.visible = true
        }}
      />
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        widthRequest={220}
        cssClasses={["preview-props-editor"]}
        $={(self) => {
          panelBox = self
          self.append(propsPanel)
          // Rebuild when switching components
          current.subscribe(() => buildPropsPanel())
          // Rebuild when extra CSS classes change
          extraClasses.subscribe(() => buildPropsPanel())
          buildPropsPanel()
        }}
      />
    </Gtk.Box>
  )
}
