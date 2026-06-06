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
  #dpmsEnabled = true
  #dpmsTimeout = 600
  #suspendEnabled = false
  #suspendTimeout = 1800
  #process: AstalIO.Process | null = null
  #settings: {
    autoLockEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number; subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number; subscribe(cb: () => void): () => void }
    dpmsEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    dpmsTimeout: { get(): number; subscribe(cb: () => void): () => void }
    suspendEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    suspendTimeout: { get(): number; subscribe(cb: () => void): () => void }
    setAutoLockEnabled: (v: boolean) => void
    setIdleTimeout: (v: number) => void
    setScreenDimEnabled: (v: boolean) => void
    setScreenDimTimeout: (v: number) => void
    setDpmsEnabled: (v: boolean) => void
    setDpmsTimeout: (v: number) => void
    setSuspendEnabled: (v: boolean) => void
    setSuspendTimeout: (v: number) => void
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
    // Cross-validate: keep dim < idle < dpms < suspend
    if (this.#dimTimeout >= v) {
      this.#dimTimeout = Math.max(30, v - 10)
      this.notify("dim-timeout")
    }
    if (this.#dpmsTimeout <= v) {
      this.#dpmsTimeout = v + 10
      this.notify("dpms-timeout")
    }
    if (this.#suspendTimeout <= this.#dpmsTimeout) {
      this.#suspendTimeout = this.#dpmsTimeout + 10
      this.notify("suspend-timeout")
    }
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
  get dpmsEnabled() {
    return this.#dpmsEnabled
  }

  @setter(Boolean)
  set dpmsEnabled(v: boolean) {
    if (this.#dpmsEnabled === v) return
    this.#dpmsEnabled = v
    this.#settings?.setDpmsEnabled(v)
    this.#apply()
    this.notify("dpms-enabled")
  }

  @getter(Number)
  get dpmsTimeout() {
    return this.#dpmsTimeout
  }

  @setter(Number)
  set dpmsTimeout(v: number) {
    v = Math.max(this.#idleTimeout + 10, Math.min(3600, v))
    if (this.#dpmsTimeout === v) return
    this.#dpmsTimeout = v
    // Cross-validate: keep dpms < suspend
    if (this.#suspendTimeout <= v) {
      this.#suspendTimeout = v + 10
      this.notify("suspend-timeout")
    }
    this.#settings?.setDpmsTimeout(v)
    this.#apply()
    this.notify("dpms-timeout")
  }

  @getter(Boolean)
  get suspendEnabled() {
    return this.#suspendEnabled
  }

  @setter(Boolean)
  set suspendEnabled(v: boolean) {
    if (this.#suspendEnabled === v) return
    this.#suspendEnabled = v
    this.#settings?.setSuspendEnabled(v)
    this.#apply()
    this.notify("suspend-enabled")
  }

  @getter(Number)
  get suspendTimeout() {
    return this.#suspendTimeout
  }

  @setter(Number)
  set suspendTimeout(v: number) {
    v = Math.max(this.#dpmsTimeout + 10, Math.min(7200, v))
    if (this.#suspendTimeout === v) return
    this.#suspendTimeout = v
    this.#settings?.setSuspendTimeout(v)
    this.#apply()
    this.notify("suspend-timeout")
  }

  @getter(Boolean)
  get available() {
    return GLib.find_program_in_path("hypridle") !== null
  }

  init(settings: {
    autoLockEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    idleTimeout: { get(): number; subscribe(cb: () => void): () => void }
    screenDimEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    screenDimTimeout: { get(): number; subscribe(cb: () => void): () => void }
    dpmsEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    dpmsTimeout: { get(): number; subscribe(cb: () => void): () => void }
    suspendEnabled: { get(): boolean; subscribe(cb: () => void): () => void }
    suspendTimeout: { get(): number; subscribe(cb: () => void): () => void }
    setAutoLockEnabled: (v: boolean) => void
    setIdleTimeout: (v: number) => void
    setScreenDimEnabled: (v: boolean) => void
    setScreenDimTimeout: (v: number) => void
    setDpmsEnabled: (v: boolean) => void
    setDpmsTimeout: (v: number) => void
    setSuspendEnabled: (v: boolean) => void
    setSuspendTimeout: (v: number) => void
  }) {
    if (this.#settings) {
      logger.warn("hypridle", "init() called but already initialized — skipping")
      return
    }
    this.#settings = settings
    this.#enabled = settings.autoLockEnabled.get()
    this.#idleTimeout = settings.idleTimeout.get()
    this.#dimEnabled = settings.screenDimEnabled.get()
    this.#dimTimeout = settings.screenDimTimeout.get()
    this.#dpmsEnabled = settings.dpmsEnabled.get()
    this.#dpmsTimeout = settings.dpmsTimeout.get()
    this.#suspendEnabled = settings.suspendEnabled.get()
    this.#suspendTimeout = settings.suspendTimeout.get()

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
      // Ensure dpms/suspend timeouts stay ahead of the lock timeout
      if (this.#dpmsTimeout < v + 10) {
        this.#dpmsTimeout = v + 10
        this.notify("dpms-timeout")
      }
      if (this.#suspendTimeout < this.#dpmsTimeout + 10) {
        this.#suspendTimeout = this.#dpmsTimeout + 10
        this.notify("suspend-timeout")
      }
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

    settings.dpmsEnabled.subscribe(() => {
      const v = settings.dpmsEnabled.get()
      if (this.#dpmsEnabled === v) return
      this.#dpmsEnabled = v
      this.notify("dpms-enabled")
      this.#apply()
    })

    settings.dpmsTimeout.subscribe(() => {
      const v = settings.dpmsTimeout.get()
      if (this.#dpmsTimeout === v) return
      this.#dpmsTimeout = v
      this.notify("dpms-timeout")
      // Ensure suspend timeout stays ahead of dpms timeout
      if (this.#suspendTimeout < v + 10) {
        this.#suspendTimeout = v + 10
        this.notify("suspend-timeout")
      }
      this.#apply()
    })

    settings.suspendEnabled.subscribe(() => {
      const v = settings.suspendEnabled.get()
      if (this.#suspendEnabled === v) return
      this.#suspendEnabled = v
      this.notify("suspend-enabled")
      this.#apply()
    })

    settings.suspendTimeout.subscribe(() => {
      const v = settings.suspendTimeout.get()
      if (this.#suspendTimeout === v) return
      this.#suspendTimeout = v
      this.notify("suspend-timeout")
      this.#apply()
    })

    // Caffeinated mode (GTK idle inhibit) is handled BY hypridle itself.
    // hypridle monitors the org.freedesktop.ScreenSaver D-Bus interface
    // and automatically pauses its listeners when an inhibitor is active.
    // We don't need to start/stop the process — just let inhibit work.
    this.#apply()
  }

  #apply() {
    try {
      if (!this.available) return
      if (this.#enabled) {
        this.#writeConfig()
        this.#restart()
      } else {
        this.#stop()
      }
    } catch (e) {
      logger.error("hypridle", "unexpected error in #apply:", e)
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
        "  after_sleep_cmd = hyprctl dispatch dpms on",
        "}",
      ]

      // Tier 1: dim screen before lock
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

      // Tier 2: lock screen
      lines.push(
        "",
        "listener {",
        `  timeout = ${this.#idleTimeout}`,
        "  on-timeout = shade-shell lockscreen",
        "}",
      )

      // Tier 3: turn off display (DPMS)
      if (this.#dpmsEnabled && this.#dpmsTimeout > this.#idleTimeout) {
        lines.push(
          "",
          "listener {",
          `  timeout = ${this.#dpmsTimeout}`,
          "  on-timeout = hyprctl dispatch dpms off",
          "  on-resume = hyprctl dispatch dpms on",
          "}",
        )
      }

      // Tier 4: suspend system
      if (this.#suspendEnabled && this.#suspendTimeout > this.#dpmsTimeout) {
        lines.push(
          "",
          "listener {",
          `  timeout = ${this.#suspendTimeout}`,
          "  on-timeout = systemctl suspend",
          "}",
        )
      }

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
      } catch (e) {
        logger.warn("hypridle", "failed to kill old process:", e)
      }
      this.#process = null
    }
    try {
      AstalIO.Process.exec("pkill -x hypridle")
    } catch (e) {
      logger.warn("hypridle", "pkill failed (hypridle may not be running):", e)
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
      } catch (e) {
        logger.warn("hypridle", "failed to kill process:", e)
      }
      this.#process = null
    }
    try {
      AstalIO.Process.exec("pkill -x hypridle")
    } catch {
      // pkill may fail if hypridle is not running — that's normal
    }
    // Remove the config file so external hypridle instances
    // (e.g. systemd services) don't pick up the lock listener
    try {
      const file = Gio.File.new_for_path(CONFIG_PATH)
      if (file.query_exists(null)) {
        file.delete(null)
      }
    } catch (e) {
      logger.error("hypridle", "failed to delete config file:", e)
    }
  }

  dispose() {
    this.#stop()
  }
}
