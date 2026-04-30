import AstalHyprland from "gi://AstalHyprland?version=0.1"
import Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio?version=2.0"
import GObject, { getter, register } from "gnim/gobject"
import { createBinding } from "gnim"

const Gdk2HyprMonitor =
  (GMonitor: Gdk.Monitor) => {
    const hyprland = AstalHyprland.get_default()
    const monitor = hyprland.get_monitors()
      .find(m => m.model === GMonitor.model)
    return monitor ?? hyprland.get_monitor(0)
  }

@register({ GTypeName: "MonitorService" })
class MonitorService extends GObject.Object {
  static instance: MonitorService

  static get_default() {
    if (!this.instance) this.instance = new MonitorService()
    return this.instance
  }

  #monitors: Gdk.Monitor[] = []

  @getter(Array)
  get monitors() {
    return this.#monitors
  }

  constructor() {
    super()
    const display = Gdk.Display.get_default()
    if (!display) {
      print("Shade: No display available for monitor tracking")
      return
    }
    const monitorList = display.get_monitors()
    this.#update(monitorList)

    monitorList.connect("items-changed", () => {
      this.#update(monitorList)
    })
  }

  #update(monitorList: Gio.ListModel) {
    this.#monitors = Array.from(monitorList as Gio.ListStore<Gdk.Monitor>)
    this.notify("monitors")
  }
}

export const monitors = createBinding(MonitorService.get_default(), "monitors")

export { Gdk2HyprMonitor, MonitorService }
