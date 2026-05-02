import GObject, { getter, register, setter } from "gnim/gobject"
import AstalIO from "gi://AstalIO?version=0.1"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"

interface MatugenColors {
  colors?: {
    light?: {
      primary?: string
      secondary?: string
      tertiary?: string
      error?: string
    }
    dark?: {
      primary?: string
      secondary?: string
      tertiary?: string
      error?: string
    }
  }
}

function parseMatugenJson(json: string): { primary: string, secondary: string, error: string } | null {
  try {
    const data: MatugenColors = JSON.parse(json)
    const colors = data.colors?.dark || data.colors?.light
    if (!colors) return null
    return {
      primary: colors.primary || "#3584e4",
      secondary: colors.secondary || "#3584e4",
      error: colors.error || "#c01c28",
    }
  } catch (e) {
    print("[Theming] failed to parse matugen output:", (e as Error).message)
    return null
  }
}

@register({ GTypeName: "Theming" })
export default class Theming extends GObject.Object {
  static instance: Theming
  static get_default() {
    if (!this.instance) this.instance = new Theming()
    return this.instance
  }

  #enabled = false
  #cssProvider: Gtk.CssProvider | null = null
  #settings: {
    dynamicThemingEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    wallpaperDay: { get(): string, subscribe(cb: () => void): () => void }
    wallpaperNight: { get(): string, subscribe(cb: () => void): () => void }
  } | null = null

  @getter(Boolean)
  get enabled() { return this.#enabled }

  @setter(Boolean)
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    if (v) {
      this.#regenerate()
    } else {
      this.#clear()
    }
    this.notify("enabled")
  }

  @getter(Boolean)
  get available() {
    try {
      AstalIO.Process.exec("which matugen")
      return true
    } catch { return false }
  }

  init(settings: {
    dynamicThemingEnabled: { get(): boolean, subscribe(cb: () => void): () => void }
    wallpaperDay: { get(): string, subscribe(cb: () => void): () => void }
    wallpaperNight: { get(): string, subscribe(cb: () => void): () => void }
  }) {
    this.#settings = settings
    this.#enabled = settings.dynamicThemingEnabled.get()

    settings.dynamicThemingEnabled.subscribe(() => {
      const newEnabled = settings.dynamicThemingEnabled.get()
      if (newEnabled !== this.#enabled) {
        this.enabled = newEnabled
      }
    })

    // Listen for wallpaper changes
    settings.wallpaperDay.subscribe(() => this.#onWallpaperChange())
    settings.wallpaperNight.subscribe(() => this.#onWallpaperChange())

    if (this.#enabled) {
      this.#regenerate()
    }
  }

  #onWallpaperChange() {
    if (this.#enabled) {
      // Debounce: wait a bit for the file to be written
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this.#regenerate()
        return GLib.SOURCE_REMOVE
      })
    }
  }

  regenerate() {
    if (!this.available) {
      print("[Theming] matugen not available")
      return
    }
    this.#regenerate()
  }

  #regenerate() {
    if (!this.#settings) return
    const wallpaper = this.#settings.wallpaperDay.get()
    if (!wallpaper || !GLib.file_test(wallpaper, GLib.FileTest.EXISTS)) {
      print("[Theming] wallpaper not found:", wallpaper)
      return
    }

    AstalIO.Process.exec_asyncv(["matugen", "image", wallpaper, "--json"], (_, res) => {
      try {
        const out = AstalIO.Process.exec_asyncv_finish(res)
        const colors = parseMatugenJson(out)
        if (colors) {
          this.#applyColors(colors)
        }
      } catch (e) {
        print("[Theming] matugen failed:", (e as Error).message)
      }
    })
  }

  #applyColors(colors: { primary: string, secondary: string, error: string }) {
    this.#clear()

    const css = `
      @define-color accent_color ${colors.primary};
      @define-color accent_bg_color ${colors.primary};
      @define-color destructive_color ${colors.error};
    `

    this.#cssProvider = new Gtk.CssProvider()
    this.#cssProvider.load_from_string(css)

    const display = Gdk.Display.get_default()
    if (display) {
      Gtk.StyleContext.add_provider_for_display(
        display,
        this.#cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_USER + 1
      )
    }
  }

  #clear() {
    if (this.#cssProvider) {
      const display = Gdk.Display.get_default()
      if (display) {
        Gtk.StyleContext.remove_provider_for_display(
          display,
          this.#cssProvider
        )
      }
      this.#cssProvider = null
    }
  }
}
