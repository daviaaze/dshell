/**
 * PreviewWindow — sidebar + preview area.
 *
 * Uses createEffect to render components inside a Gnim Scope, so that
 * For, onCleanup, and other scope-dependent features work correctly.
 *
 * Architecture: this file is the orchestrator. Individual concerns are
 * extracted into companion modules:
 *   Sidebar.tsx       — component list with search + category headers
 *   IconPickerPopover.tsx — singleton icon browser
 *   PropControls.ts   — prop row builders (boolean, string, number, select, icon)
 *   StylesEditor.ts   — CSS class chip editor + toggle grid
 *   PresetSelector.ts — preset dropdown
 *   Toolbar.ts        — viewport size + background controls
 */

import Gtk from "gi://Gtk?version=4.0"
import Adw from "gi://Adw?version=1"
import { createEffect, createState, createBinding } from "gnim"
import {
  entries,
  findEntry,
  type ComponentEntry,
} from "./registry"
import { buildSidebar } from "./Sidebar"
import { propBuilders } from "./PropControls"
import { buildStylesPanel } from "./StylesEditor"
import { buildPresetSelector } from "./PresetSelector"
import { buildToolbar } from "./Toolbar"

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

  // ── viewport / background state ──────────────────────────────────────
  const [viewportW, setViewportW] = createState(-1)
  const [bgMode, setBgMode] = createState("default")
  const [extraClasses, setExtraClasses] = createState<string[]>([])
  const isDark = createBinding(Adw.StyleManager.get_default(), "dark")

  // ── panel visibility (for toggle button) ─────────────────────────────
  let panelVisible = true
  let panelBox: Gtk.Box | null = null
  let panelSep: Gtk.Separator | null = null

  // ── selection helper ─────────────────────────────────────────────────
  const selectComponent = (entry: ComponentEntry) => {
    setCurrent(entry)
    setPropsState({ ...entry.defaultProps })
  }

  const initialIdx = entries.indexOf(initial ?? entries[0])

  // ════════════════════════ PROPS PANEL ════════════════════════
  const propsPanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    widthRequest: 220,
    cssClasses: ["preview-props-editor"],
  })

  let _buildingPanel = false

  const buildPropsPanel = () => {
    if (_buildingPanel) return
    _buildingPanel = true

    let c = propsPanel.get_first_child()
    while (c) {
      propsPanel.remove(c)
      c = propsPanel.get_first_child()
    }

    const entry = current()
    const eProps = entry?.editableProps
      ? Object.entries(entry.editableProps)
      : []

    const scroller = new Gtk.ScrolledWindow({ vexpand: true })
    const inner = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      marginStart: 8,
      marginEnd: 8,
      marginTop: 4,
      marginBottom: 8,
    })

    // Styles section (always visible, even without editableProps)
    buildStylesPanel(inner, () => extraClasses(), setExtraClasses)

    if (eProps.length === 0) {
      scroller.set_child(inner)
      propsPanel.append(scroller)
      _buildingPanel = false
      return
    }

    // Props header
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

    // Styles section
    buildStylesPanel(inner, () => extraClasses(), setExtraClasses)

    if (eProps.length > 0) {
      inner.append(
        new Gtk.Separator({ marginTop: 4, marginBottom: 4 }),
      )
    }

    // Dispatch each prop to its type-specific builder
    for (const [key, def] of eProps) {
      const builder = propBuilders[def.type]
      if (builder) {
        inner.append(
          builder(
            key,
            def,
            () => propsState(),
            setPropsState,
          ),
        )
      }
    }

    scroller.set_child(inner)
    propsPanel.append(scroller)
    _buildingPanel = false
  }

  // ════════════════════════ REACTIVE RENDER ════════════════════════
  let previewSlot: Gtk.Box | null = null

  createEffect(() => {
    const c = current()
    const p = propsState()
    const xClasses = extraClasses()

    if (!previewSlot) return

    const old = previewSlot.get_first_child()
    if (old) previewSlot.remove(old)

    try {
      const widget = c.render(p)
      if (widget instanceof Gtk.Widget) {
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
        $={(self) =>
          self.append(
            buildSidebar(initialIdx, {
              onSelect: selectComponent,
              current: () => current(),
            }),
          )
        }
      />

      <Gtk.Separator />

      {/* Content */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} hexpand vexpand>
        {/* Header */}
        <Gtk.Box
          spacing={8}
          marginStart={12}
          marginEnd={12}
          marginTop={8}
          marginBottom={8}
        >
          <Gtk.Label
            label={current().name}
            cssClasses={["title-3"]}
            hexpand
          />
          <Gtk.Label
            label={current().description}
            cssClasses={["caption", "dim-label"]}
          />

          {/* Preset selector */}
          <Gtk.Box
            spacing={4}
            $={(self) =>
              self.append(
                buildPresetSelector(
                  () => current(),
                  setPropsState,
                ),
              )
            }
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
          $={(self) =>
            self.append(
              buildToolbar(
                () => viewportW(),
                setViewportW,
                () => bgMode(),
                setBgMode,
              ),
            )
          }
        />

        <Gtk.Separator />

        {/* Preview canvas */}
        <Gtk.ScrolledWindow
          hexpand
          vexpand
          cssClasses={["preview-canvas"]}
          $={(self) => {
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
          current.subscribe(() => buildPropsPanel())
          extraClasses.subscribe(() => buildPropsPanel())
          buildPropsPanel()
        }}
      />
    </Gtk.Box>
  )
}
