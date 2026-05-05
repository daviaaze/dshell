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
    nightLightEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    nightLightTemperature: { get(): number, subscribe(cb: () => void): () => void }
    nightLightAutoSchedule: { get(): boolean, subscribe(cb: () => void): () => void }
    setNightLightEnabled: (v: boolean) => void
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
    this.notify("auto-schedule")
  }

  @getter(Boolean)
  get available() {
    try {
      AstalIO.Process.exec("which hyprsunset")
      return true
    } catch { return false }
  }

  init(settings: {
    nightLightEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    nightLightTemperature: { get(): number, subscribe(cb: () => void): () => void }
    nightLightAutoSchedule: { get(): boolean, subscribe(cb: () => void): () => void }
    setNightLightEnabled: (v: boolean) => void
  }, colorScheme: ColorScheme) {
    this.#settings = settings
    this.#colorScheme = colorScheme
    this.#enabled = settings.nightLightEnabled.get()
    this.#temperature = settings.nightLightTemperature.get()
    this.#autoSchedule = settings.nightLightAutoSchedule.get()

    settings.nightLightEnabled.subscribe(() => {
      const newEnabled = settings.nightLightEnabled.get()
      if (newEnabled !== this.#enabled) {
        this.#enabled = newEnabled
        this.notify("enabled")
        this.#sync()
      }
    })

    settings.nightLightTemperature.subscribe(() => {
      const newTemp = settings.nightLightTemperature.get()
      if (newTemp !== this.#temperature) {
        this.#temperature = newTemp
        this.notify("temperature")
        if (this.#enabled) this.#sync()
      }
    })

    settings.nightLightAutoSchedule.subscribe(() => {
      const newAuto = settings.nightLightAutoSchedule.get()
      if (newAuto !== this.#autoSchedule) {
        this.#autoSchedule = newAuto
        this.notify("auto-schedule")
        this.#checkSchedule()
      }
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
        this.#settings.setNightLightEnabled(shouldBeOn)
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
