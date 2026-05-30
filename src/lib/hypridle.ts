import GObject, { getter, register, setter } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import logger from "#/lib/logger"

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
    autoLockEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number; subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number; subscribe(cb: () => void): () => void }
    setAutoLockEnabled: (v: boolean) => void
    setIdleTimeout: (v: number) => void
    setScreenDimEnabled: (v: boolean) => void
    setScreenDimTimeout: (v: number) => void
  } | null = null

  @getter(Boolean)
  get enabled() {
    return this.#enabled
  }

  @setter(Boolean)
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    this.#settings?.setAutoLockEnabled(v)
    this.#apply()
    this.notify("enabled")
  }

  @getter(Number)
  get idleTimeout() {
    return this.#idleTimeout
  }

  @setter(Number)
  set idleTimeout(v: number) {
    v = Math.max(60, Math.min(1800, v))
    if (this.#idleTimeout === v) return
    this.#idleTimeout = v
    this.#settings?.setIdleTimeout(v)
    this.#apply()
    this.notify("idle-timeout")
  }

  @getter(Number)
  get dimTimeout() {
    return this.#dimTimeout
  }

  @setter(Number)
  set dimTimeout(v: number) {
    v = Math.max(30, Math.min(this.#idleTimeout - 10, v))
    if (this.#dimTimeout === v) return
    this.#dimTimeout = v
    this.#settings?.setScreenDimTimeout(v)
    this.#apply()
    this.notify("dim-timeout")
  }

  @getter(Boolean)
  get dimEnabled() {
    return this.#dimEnabled
  }

  @setter(Boolean)
  set dimEnabled(v: boolean) {
    if (this.#dimEnabled === v) return
    this.#dimEnabled = v
    this.#settings?.setScreenDimEnabled(v)
    this.#apply()
    this.notify("dim-enabled")
  }

  @getter(Boolean)
  get available() {
    try {
      AstalIO.Process.exec("which hypridle")
      return true
    } catch {
      return false
    }
  }

  init(settings: {
    autoLockEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number; subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number; subscribe(cb: () => void): () => void }
    setAutoLockEnabled: (v: boolean) => void
    setIdleTimeout: (v: number) => void
    setScreenDimEnabled: (v: boolean) => void
    setScreenDimTimeout: (v: number) => void
  }) {
    this.#settings = settings
    this.#enabled = settings.autoLockEnabled.get()
    this.#idleTimeout = settings.idleTimeout.get()
    this.#dimEnabled = settings.screenDimEnabled.get()
    this.#dimTimeout = settings.screenDimTimeout.get()

    settings.autoLockEnabled.subscribe(() => {
      const v = settings.autoLockEnabled.get()
      if (this.#enabled === v) return
      this.#enabled = v
      this.notify("enabled")
      this.#apply()
    })

    settings.idleTimeout.subscribe(() => {
      const v = settings.idleTimeout.get()
      if (this.#idleTimeout === v) return
      this.#idleTimeout = v
      this.notify("idle-timeout")
      this.#apply()
    })

    settings.screenDimEnabled.subscribe(() => {
      const v = settings.screenDimEnabled.get()
      if (this.#dimEnabled === v) return
      this.#dimEnabled = v
      this.notify("dim-enabled")
      this.#apply()
    })

    settings.screenDimTimeout.subscribe(() => {
      const v = settings.screenDimTimeout.get()
      if (this.#dimTimeout === v) return
      this.#dimTimeout = v
      this.notify("dim-timeout")
      this.#apply()
    })

    // Caffeinated mode (GTK idle inhibit) is handled BY hypridle itself.
    // hypridle monitors the org.freedesktop.ScreenSaver D-Bus interface
    // and automatically pauses its listeners when an inhibitor is active.
    // We don't need to start/stop the process — just let inhibit work.
    this.#apply()
  }

  #apply() {
    if (!this.available) return
    if (this.#enabled) {
      this.#writeConfig()
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
        "  lock_cmd = shade-shell lockscreen",
        "  before_sleep_cmd = shade-shell lockscreen",
        "}",
      ]

      if (this.#dimEnabled && this.#dimTimeout < this.#idleTimeout) {
        lines.push(
          "",
          "listener {",
          `  timeout = ${this.#dimTimeout}`,
          "  on-timeout = sh -c 'brightnessctl get > /tmp/shade-brightness-resume && brightnessctl set 10%'",
          "  on-resume = sh -c '[ -f /tmp/shade-brightness-resume ] && brightnessctl set $(cat /tmp/shade-brightness-resume) && rm -f /tmp/shade-brightness-resume'",
          "}",
        )
      }

      lines.push(
        "",
        "listener {",
        `  timeout = ${this.#idleTimeout}`,
        "  on-timeout = shade-shell lockscreen",
        "}",
      )

      const config = lines.join("\n") + "\n"
      GLib.file_set_contents(CONFIG_PATH, new TextEncoder().encode(config))
    } catch (e) {
      logger.error("hypridle", "failed to write config:", e)
    }
  }

  #restart() {
    // Kill any existing hypridle process (don't call #stop() which
    // would delete the config we just wrote)
    if (this.#process) {
      try {
        this.#process.kill()
      } catch {
        /* ignore */
      }
      this.#process = null
    }
    try {
      AstalIO.Process.exec("pkill -x hypridle")
    } catch {
      /* ignore */
    }
    try {
      this.#process = AstalIO.Process.subprocessv(["hypridle"])
    } catch (e) {
      logger.error("hypridle", "failed to start:", e)
    }
  }

  #stop() {
    if (this.#process) {
      try {
        this.#process.kill()
      } catch {
        /* ignore */
      }
      this.#process = null
    }
    try {
      AstalIO.Process.exec("pkill -x hypridle")
    } catch {
      /* ignore */
    }
    // Remove the config file so external hypridle instances
    // (e.g. systemd services) don't pick up the lock listener
    try {
      const file = Gio.File.new_for_path(CONFIG_PATH)
      if (file.query_exists(null)) {
        file.delete(null)
      }
    } catch {
      /* ignore */
    }
  }

  dispose() {
    this.#stop()
  }
}
