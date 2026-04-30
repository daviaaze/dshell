import GObject, { getter, register, setter } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import GLib from "gi://GLib?version=2.0"
import { ColorScheme } from "#/lib/colorScheme"

@register({ GTypeName: "NightLight" })
export default class NightLight extends GObject.Object {
  static instance: NightLight
  static get_default() {
    if (!this.instance) this.instance = new NightLight()
    return this.instance
  }

  #enabled = false
  #temperature = 3500
  #autoSchedule = false
  #process: AstalIO.Process | null = null
  #pollTimer: number | null = null
  #colorScheme: ColorScheme | null = null
  #settings: {
    get_boolean(key: string): boolean
    get_int(key: string): number
    set_boolean(key: string, val: boolean): void
    set_int(key: string, val: number): void
    connect(changed: string, cb: () => void): number
  } | null = null

  @getter(Boolean)
  get enabled() { return this.#enabled }

  @setter(Boolean)
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    this.#sync()
    this.notify("enabled")
  }

  @getter(Number)
  get temperature() { return this.#temperature }

  @setter(Number)
  set temperature(v: number) {
    v = Math.max(2000, Math.min(6500, v))
    if (this.#temperature === v) return
    this.#temperature = v
    if (this.#enabled) this.#sync()
    this.notify("temperature")
  }

  @getter(Boolean)
  get autoSchedule() { return this.#autoSchedule }

  @setter(Boolean)
  set autoSchedule(v: boolean) {
    if (this.#autoSchedule === v) return
    this.#autoSchedule = v
    this.#checkSchedule()
    this.notify("autoSchedule")
  }

  @getter(Boolean)
  get available() {
    try {
      AstalIO.Process.exec("which hyprsunset")
      return true
    } catch { return false }
  }

  init(settings: {
    get_boolean(key: string): boolean
    get_int(key: string): number
    set_boolean(key: string, val: boolean): void
    set_int(key: string, val: number): void
    connect(changed: string, cb: () => void): number
  }, colorScheme: ColorScheme) {
    this.#settings = settings
    this.#colorScheme = colorScheme
    this.#enabled = settings.get_boolean("night-light-enabled")
    this.#temperature = settings.get_int("night-light-temperature")
    this.#autoSchedule = settings.get_boolean("night-light-auto-schedule")

    settings.connect("changed", () => {
      const newEnabled = settings.get_boolean("night-light-enabled")
      const newTemp = settings.get_int("night-light-temperature")
      const newAuto = settings.get_boolean("night-light-auto-schedule")
      if (newEnabled !== this.#enabled) {
        this.#enabled = newEnabled
        this.notify("enabled")
      }
      if (newTemp !== this.#temperature) {
        this.#temperature = newTemp
        this.notify("temperature")
      }
      if (newAuto !== this.#autoSchedule) {
        this.#autoSchedule = newAuto
        this.notify("autoSchedule")
      }
      this.#sync()
    })

    this.#sync()
    this.#startPoll()
  }

  #sync() {
    if (!this.available) return
    if (this.#enabled) {
      this.#startProcess()
    } else {
      this.#stopProcess()
    }
  }

  #startProcess() {
    this.#stopProcess()
    try {
      this.#process = AstalIO.Process.subprocessv([
        "hyprsunset", "--temperature", this.#temperature.toString()
      ])
    } catch (e) {
      print("[NightLight] failed to start hyprsunset:", (e as Error).message)
    }
  }

  #stopProcess() {
    if (this.#process) {
      try { this.#process.kill() } catch { /* ignore */ }
      this.#process = null
    }
    // Also kill any stray hyprsunset processes we may have started
    try {
      AstalIO.Process.exec("pkill -f 'hyprsunset --temperature'")
    } catch { /* ignore */ }
  }

  #checkSchedule() {
    if (!this.#autoSchedule || !this.#colorScheme) return
    const isDaytime = this.#colorScheme.daytime
    const shouldBeOn = !isDaytime
    if (this.#enabled !== shouldBeOn) {
      this.enabled = shouldBeOn
      if (this.#settings) {
        this.#settings.set_boolean("night-light-enabled", shouldBeOn)
      }
    }
  }

  #startPoll() {
    if (this.#pollTimer) GLib.source_remove(this.#pollTimer)
    this.#pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
      if (this.#autoSchedule) this.#checkSchedule()
      return GLib.SOURCE_CONTINUE
    })
  }

  dispose() {
    if (this.#pollTimer) {
      GLib.source_remove(this.#pollTimer)
      this.#pollTimer = null
    }
    this.#stopProcess()
  }
}
