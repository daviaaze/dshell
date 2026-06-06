import Adw from "gi://Adw"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import Astal from "gi://Astal?version=4.0"
import { createRoot } from "gnim"
import { register } from "gnim/gobject"
import { gettext } from "gettext"
import { SettingsProvider } from "./lib/settings"
import { registerActions, requestHandler } from "./lib/requestHandler"
import { widgets } from "./widget"
import WindowManager from "./lib/windowManager"
import logger, { perf } from "./lib/logger"
import css from "./shade.css"

@register()
export class ShadeShell extends Adw.Application {
  declare osd: Astal.Window
  declare applauncher: Astal.Window
  declare notifications: Astal.Window
  declare bar: Astal.Window[]
  declare wallpaper: Astal.Window[]
  declare lockscreen: Astal.Window[]
  declare quicksettings: Astal.Window
  declare settings: Adw.Window

  constructor() {
    super({
      applicationId: import.meta.domain,
      version: import.meta.version,
      flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
    })
    GLib.set_prgname(import.meta.name)
    GLib.set_application_name(gettext("Shade Shell"))
    this.bar = []
    this.wallpaper = []
    this.lockscreen = []
    registerActions(this)
  }

  private initCss() {
    perf.start("initCss", "mount")
    const display = Gdk.Display.get_default()
    if (!display) {
      logger.warn("app", "No display available. Cannot initialize CSS.")
      return
    }
    const provider = new Gtk.CssProvider()
    provider.load_from_data(css, -1)

    Gtk.StyleContext.add_provider_for_display(
      display,
      provider,
      Gtk.STYLE_PROVIDER_PRIORITY_USER,
    )

    // Force popover shadows off at max priority — libadwaita
    // sometimes evades the regular cascade on popover > contents.
    const shadowFix = new Gtk.CssProvider()
    shadowFix.load_from_string("popover > contents { box-shadow: none; } popover > arrow { box-shadow: none; }")
    Gtk.StyleContext.add_provider_for_display(
      display,
      shadowFix,
      Gtk.STYLE_PROVIDER_PRIORITY_USER + 100,
    )

    logger.debug("mount", "CSS provider registered")
    perf.stop("initCss", "mount")
  }

  vfunc_command_line(cmd: Gio.ApplicationCommandLine) {
    logger.debug("app", `vfunc_command_line isRemote=${cmd.isRemote}`)
    if (cmd.isRemote) requestHandler(cmd, this)
    else {
      perf.start("widgets-mount", "mount")
      createRoot((dispose) => {
        this.connect("shutdown", dispose)
        this.initCss()
        SettingsProvider(() => widgets())
      })
    }
    return 0
  }
}
export const app = new ShadeShell()
