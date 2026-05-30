import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import GObject, { getter, register, setter } from "gnim/gobject"

@register({ GTypeName: "IdleInhibit" })
export default class Inhibit extends GObject.Object {
  static instance: Inhibit
  static get_default() {
    if (!this.instance) this.instance = new Inhibit()
    return this.instance
  }

  #idle: boolean
  #cookie: number
  #app: Adw.Application | null = null
  #initialized = false

  @getter(Boolean)
  get idle() {
    return this.#idle
  }

  @setter(Boolean)
  set idle(state) {
    if (state === this.#idle) return
    if (state) {
      if (this.#cookie !== 0) this.#app?.uninhibit(this.#cookie)
      this.#cookie =
        this.#app?.inhibit(
          null,
          Gtk.ApplicationInhibitFlags.IDLE,
          "toggled by shade-shell",
        ) ?? 0
    } else {
      if (this.#cookie !== 0) {
        this.#app?.uninhibit(this.#cookie)
        this.#cookie = 0
      }
    }
    this.#idle = state
    this.notify("idle")
  }

  init(app: Adw.Application) {
    if (this.#initialized) {
      print("[Shade] [WARN] [inhibit] init() called but already initialized — skipping")
      return
    }
    this.#initialized = true
    this.#app = app
  }

  constructor() {
    super()
    this.#idle = false
    this.#cookie = 0
    this.#initialized = false
  }
}
