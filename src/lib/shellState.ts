import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register, setter } from "gnim/gobject"
import logger from "#/lib/logger"

@register({ GTypeName: "ShellState" })
export default class ShellState extends GObject.Object {
  static instance: ShellState

  static get_default() {
    if (!this.instance) this.instance = new ShellState()
    return this.instance
  }

  #launcherOpen = false
  #launcherQuery = ""
  #qsOpen = false
  #screenlocked = false

  @getter(Boolean)
  get launcherOpen() {
    return this.#launcherOpen
  }

  @getter(String)
  get launcherQuery() {
    return this.#launcherQuery
  }

  @setter(String)
  set launcherQuery(v: string) {
    this.#launcherQuery = v
    this.notify("launcher-query")
  }

  @setter(Boolean)
  set launcherOpen(v: boolean) {
    logger.debug("state", `ShellState.launcherOpen ${this.#launcherOpen} -> ${v}`)
    this.#launcherOpen = v
    this.notify("launcher-open")
  }

  @getter(Boolean)
  get qsOpen() {
    return this.#qsOpen
  }

  @setter(Boolean)
  set qsOpen(v: boolean) {
    logger.debug("state", `ShellState.qsOpen ${this.#qsOpen} -> ${v}`)
    this.#qsOpen = v
    this.notify("qs-open")
  }

  @getter(Boolean)
  get screenlocked() {
    return this.#screenlocked
  }

  @setter(Boolean)
  set screenlocked(v: boolean) {
    logger.info("state", `ShellState.screenlocked ${this.#screenlocked} -> ${v}`)
    this.#screenlocked = v
    this.notify("screenlocked")
  }

  toggleLauncher() {
    this.launcherQuery = ""
    this.launcherOpen = !this.#launcherOpen
  }

  openClipboard() {
    this.launcherQuery = ">"
    this.launcherOpen = true
  }

  toggleClipboard() {
    if (this.#launcherOpen && this.#launcherQuery === ">") {
      this.launcherQuery = ""
      this.launcherOpen = false
    } else {
      this.launcherQuery = ">"
      this.launcherOpen = true
    }
  }

  toggleQuickSettings() {
    this.qsOpen = !this.#qsOpen
  }
}
