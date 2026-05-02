import GObject, { getter, register, setter } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import Inhibit from "#/lib/inhibit"

const CONFIG_PATH = `${GLib.get_user_config_dir()}/hypr/hypridle.conf`

@register({ GTypeName: "Hypridle" })
export default class Hypridle extends GObject.Object {
  static instance: Hypridle
  static get_default() {
    if (!this.instance) this.instance = new Hypridle()
    return this.instance
  }

  #enabled = true
  #idleTimeout = 300
  #dimTimeout = 240
  #dimEnabled = true
  #process: AstalIO.Process | null = null
  #settings: {
    autoLockEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number, subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number, subscribe(cb: () => void): () => void }
  } | null = null
  #inhibitId: number | null = null

  @getter(Boolean)
  get enabled() { return this.#enabled }

  @setter(Boolean)
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    this.#apply()
    this.notify("enabled")
  }

  @getter(Number)
  get idleTimeout() { return this.#idleTimeout }

  @setter(Number)
  set idleTimeout(v: number) {
    v = Math.max(60, Math.min(1800, v))
    if (this.#idleTimeout === v) return
    this.#idleTimeout = v
    this.#apply()
    this.notify("idleTimeout")
  }

  @getter(Number)
  get dimTimeout() { return this.#dimTimeout }

  @setter(Number)
  set dimTimeout(v: number) {
    v = Math.max(30, Math.min(this.#idleTimeout - 10, v))
    if (this.#dimTimeout === v) return
    this.#dimTimeout = v
    this.#apply()
    this.notify("dimTimeout")
  }

  @getter(Boolean)
  get dimEnabled() { return this.#dimEnabled }

  @setter(Boolean)
  set dimEnabled(v: boolean) {
    if (this.#dimEnabled === v) return
    this.#dimEnabled = v
    this.#apply()
    this.notify("dimEnabled")
  }

  @getter(Boolean)
  get available() {
    try {
      AstalIO.Process.exec("which hypridle")
      return true
    } catch { return false }
  }

  init(settings: {
    autoLockEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number, subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number, subscribe(cb: () => void): () => void }
  }) {
    this.#settings = settings
    this.#enabled = settings.autoLockEnabled.get()
    this.#idleTimeout = settings.idleTimeout.get()
    this.#dimEnabled = settings.screenDimEnabled.get()
    this.#dimTimeout = settings.screenDimTimeout.get()

    settings.autoLockEnabled.subscribe(() => {
      this.#enabled = settings.autoLockEnabled.get()
      this.notify("enabled")
      this.#apply()
    })

    settings.idleTimeout.subscribe(() => {
      this.#idleTimeout = settings.idleTimeout.get()
      this.notify("idleTimeout")
      this.#apply()
    })

    settings.screenDimEnabled.subscribe(() => {
      this.#dimEnabled = settings.screenDimEnabled.get()
      this.notify("dimEnabled")
      this.#apply()
    })

    settings.screenDimTimeout.subscribe(() => {
      this.#dimTimeout = settings.screenDimTimeout.get()
      this.notify("dimTimeout")
      this.#apply()
    })

    // When inhibit is active, pause hypridle
    const inhibit = Inhibit.get_default()
    this.#inhibitId = inhibit.connect("notify::idle", () => {
      if (inhibit.idle) {
        this.#stop()
      } else {
        this.#apply()
      }
    })

    this.#apply()
  }

  #apply() {
    if (!this.available) return
    this.#writeConfig()
    if (this.#enabled && !Inhibit.get_default().idle) {
      this.#restart()
    } else {
      this.#stop()
    }
  }

  #writeConfig() {
    try {
      const dir = Gio.File.new_for_path(`${GLib.get_user_config_dir()}/hypr`)
      if (!dir.query_exists(null)) {
        dir.make_directory_with_parents(null)
      }

      const lines = [
        "general {",
        '  lock_cmd = shade-shell lockscreen',
        '  before_sleep_cmd = shade-shell lockscreen',
        '}',
      ]

      if (this.#dimEnabled && this.#dimTimeout < this.#idleTimeout) {
        lines.push(
          '',
          'listener {',
          `  timeout = ${this.#dimTimeout}`,
          '  on-timeout = brightnessctl -s set 10%',
          '  on-resume = brightnessctl -r',
          '}'
        )
      }

      lines.push(
        '',
        'listener {',
        `  timeout = ${this.#idleTimeout}`,
        '  on-timeout = shade-shell lockscreen',
        '}'
      )

      const config = lines.join('\n') + '\n'
      GLib.file_set_contents(CONFIG_PATH, new TextEncoder().encode(config))
    } catch (e) {
      print("[Hypridle] failed to write config:", (e as Error).message)
    }
  }

  #restart() {
    this.#stop()
    try {
      this.#process = AstalIO.Process.subprocessv(["hypridle"])
    } catch (e) {
      print("[Hypridle] failed to start:", (e as Error).message)
    }
  }

  #stop() {
    if (this.#process) {
      try { this.#process.kill() } catch { /* ignore */ }
      this.#process = null
    }
    try {
      AstalIO.Process.exec("pkill -x hypridle")
    } catch { /* ignore */ }
  }

  dispose() {
    if (this.#inhibitId) {
      Inhibit.get_default().disconnect(this.#inhibitId)
      this.#inhibitId = null
    }
    this.#stop()
  }
}
