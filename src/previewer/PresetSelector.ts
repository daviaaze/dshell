/**
 * PresetSelector — dropdown for choosing component presets.
 *
 * Hidden when the current component has no presets. Presents
 * "Default" + named presets from the component registry.
 */

import Gtk from "gi://Gtk?version=4.0"
import { type ComponentEntry } from "./registry"

type CurrentAccessor = () => ComponentEntry
type PropsSetter = (p: Record<string, unknown>) => void

/**
 * Build a preset selector box.
 *
 * @param getCurrent    Reactive accessor for the current component
 * @param setPropsState Called when a preset is selected
 * @returns             A Gtk.Box (hidden when no presets are available)
 */
export function buildPresetSelector(
  getCurrent: CurrentAccessor,
  setPropsState: PropsSetter,
): Gtk.Box {
  const box = new Gtk.Box({ spacing: 4 })
  let presetModel: Gtk.StringList | null = null
  let presetDropDown: Gtk.DropDown | null = null

  const rebuild = () => {
    const entry = getCurrent()
    const hasPresets = !!(entry.presets && entry.presets.length > 0)
    box.visible = hasPresets
    if (!hasPresets) return

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
        const entry = getCurrent()
        if (idx === 0) {
          setPropsState({ ...entry.defaultProps })
        } else if (entry.presets && idx - 1 < entry.presets.length) {
          setPropsState({ ...entry.presets[idx - 1].props })
        }
      })
      box.append(presetDropDown)
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

  getCurrent.subscribe(rebuild)
  rebuild()

  return box
}
