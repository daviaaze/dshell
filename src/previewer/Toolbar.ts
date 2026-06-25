/**
 * Toolbar — viewport size presets and background mode selector.
 */

import Gtk from "gi://Gtk?version=4.0"

interface SizePreset {
  label: string
  value: number
  tooltip?: string
}

const SIZES: SizePreset[] = [
  { label: "Fill", value: -1 },
  { label: "S", value: 320, tooltip: "320px" },
  { label: "M", value: 768, tooltip: "768px" },
  { label: "L", value: 1024, tooltip: "1024px" },
  { label: "XL", value: 1920, tooltip: "1920px" },
]

type ViewportAccessor = () => number
type ViewportSetter = (w: number) => void
type BgModeAccessor = () => string
type BgModeSetter = (m: string) => void

/**
 * Build the viewport/background toolbar.
 *
 * @param getViewportW  Reactive accessor for current viewport width
 * @param setViewportW  Setter for viewport width
 * @param getBgMode     Reactive accessor for background mode
 * @param setBgMode     Setter for background mode
 * @returns             A fully-built toolbar Gtk.Box
 */
export function buildToolbar(
  getViewportW: ViewportAccessor,
  setViewportW: ViewportSetter,
  getBgMode: BgModeAccessor,
  setBgMode: BgModeSetter,
): Gtk.Box {
  const toolbar = new Gtk.Box({
    spacing: 6,
    marginStart: 12,
    marginEnd: 12,
    marginTop: 6,
    marginBottom: 6,
  })

  toolbar.append(
    new Gtk.Label({
      label: "Size:",
      cssClasses: ["caption"],
      valign: Gtk.Align.CENTER,
    }),
  )

  // Size preset buttons
  const sizeBox = new Gtk.Box({ spacing: 2, hexpand: true })
  const buttons: Gtk.ToggleButton[] = []
  for (const sz of SIZES) {
    const btn = new Gtk.ToggleButton({
      label: sz.label,
      active: getViewportW() === sz.value,
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
    sizeBox.append(btn)
    buttons.push(btn)
  }
  // Sync buttons when viewportW changes externally
  getViewportW.subscribe((w: number) => {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].active = SIZES[i].value === w
    }
  })
  toolbar.append(sizeBox)

  toolbar.append(new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL }))

  toolbar.append(
    new Gtk.Label({
      label: "BG:",
      cssClasses: ["caption"],
      valign: Gtk.Align.CENTER,
    }),
  )

  // Background mode dropdown
  const bgDropDown = new Gtk.DropDown({
    model: new Gtk.StringList({
      strings: ["Default", "Checkerboard", "Light", "Dark"],
    }),
    selected: 0,
  })
  bgDropDown.connect("notify::selected", () => {
    const modes = ["default", "checkerboard", "light", "dark"]
    setBgMode(modes[bgDropDown.selected] ?? "default")
  })
  toolbar.append(bgDropDown)

  return toolbar
}
