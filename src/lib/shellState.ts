import GObject, { getter, register, setter } from "gnim/gobject"

@register({ GTypeName: "ShellState" })
export default class ShellState extends GObject.Object {
  static instance: ShellState

  static get_default() {
    if (!this.instance) this.instance = new ShellState()
    return this.instance
  }

  #launcherOpen = false
  #qsOpen = false
  #screenlocked = false

  @getter(Boolean)
  get launcherOpen() {
    return this.#launcherOpen
  }

  @setter(Boolean)
  set launcherOpen(v: boolean) {
    this.#launcherOpen = v
    this.notify("launcherOpen")
  }

  @getter(Boolean)
  get qsOpen() {
    return this.#qsOpen
  }

  @setter(Boolean)
  set qsOpen(v: boolean) {
    this.#qsOpen = v
    this.notify("qsOpen")
  }

  @getter(Boolean)
  get screenlocked() {
    return this.#screenlocked
  }

  @setter(Boolean)
  set screenlocked(v: boolean) {
    this.#screenlocked = v
    this.notify("screenlocked")
  }

  toggleLauncher() {
    this.launcherOpen = !this.#launcherOpen
  }

  toggleQuickSettings() {
    this.qsOpen = !this.#qsOpen
  }
}
