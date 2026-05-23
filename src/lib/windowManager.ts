import Astal from "gi://Astal?version=4.0"
import Adw from "gi://Adw?version=1"
import GObject, { getter, register } from "gnim/gobject"

@register({ GTypeName: "WindowManager" })
export default class WindowManager extends GObject.Object {
  static instance: WindowManager

  static get_default() {
    if (!this.instance) this.instance = new WindowManager()
    return this.instance
  }

  #bars: Astal.Window[] = []
  #wallpapers: Astal.Window[] = []
  #lockscreens: Astal.Window[] = []
  #quicksettings: Astal.Window | null = null
  #osd: Astal.Window | null = null
  #applauncher: Astal.Window | null = null
  #notifications: Astal.Window | null = null
  #settings: Adw.Window | null = null
  #dock: Astal.Window | null = null

  @getter(Array)
  get bars() {
    return this.#bars
  }

  @getter(Array)
  get wallpapers() {
    return this.#wallpapers
  }

  @getter(Array)
  get lockscreens() {
    return this.#lockscreens
  }

  @getter(Object)
  get quicksettings() {
    return this.#quicksettings
  }

  @getter(Object)
  get osd() {
    return this.#osd
  }

  @getter(Object)
  get applauncher() {
    return this.#applauncher
  }

  @getter(Object)
  get notifications() {
    return this.#notifications
  }

  @getter(Object)
  get settings() {
    return this.#settings
  }

  @getter(Object)
  get dock() {
    return this.#dock
  }

  registerBar(win: Astal.Window) {
    this.#bars.push(win)
    this.notify("bars")
  }

  unregisterBar(win: Astal.Window) {
    this.#bars = this.#bars.filter((b) => b !== win)
    this.notify("bars")
  }

  registerWallpaper(win: Astal.Window) {
    this.#wallpapers.push(win)
    this.notify("wallpapers")
  }

  unregisterWallpaper(win: Astal.Window) {
    this.#wallpapers = this.#wallpapers.filter((w) => w !== win)
    this.notify("wallpapers")
  }

  registerLockscreen(win: Astal.Window) {
    this.#lockscreens.push(win)
    this.notify("lockscreens")
  }

  unregisterLockscreen(win: Astal.Window) {
    this.#lockscreens = this.#lockscreens.filter((l) => l !== win)
    this.notify("lockscreens")
  }

  setQuicksettings(win: Astal.Window | null) {
    this.#quicksettings = win
    this.notify("quicksettings")
  }

  setOsd(win: Astal.Window | null) {
    this.#osd = win
    this.notify("osd")
  }

  setApplauncher(win: Astal.Window | null) {
    this.#applauncher = win
    this.notify("applauncher")
  }

  setNotifications(win: Astal.Window | null) {
    this.#notifications = win
    this.notify("notifications")
  }

  setSettings(win: Adw.Window | null) {
    this.#settings = win
    this.notify("settings")
  }

  registerDock(win: Astal.Window) {
    this.#dock = win
    this.notify("dock")
  }

  unregisterDock(win: Astal.Window) {
    if (this.#dock === win) {
      this.#dock = null
      this.notify("dock")
    }
  }
}
