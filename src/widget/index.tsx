import applauncher from "./applauncher"
import bar from "./bar"
import dock from "./dock"
import { LockScreen } from "./lockscreen"
import notifications from "./notifications"
import osd from "./osd"
import quicksettings from "./quicksettings"
import windowswitcher from "./windowswitcher"
import { createSettingsWindow } from "./settings"
import { Wallpaper } from "./wallpaper"
import Weather from "#/lib/weather"
import KeybindsManager from "#/lib/keybinds"
import { ColorScheme } from "#/lib/colorScheme"
import Inhibit from "#/lib/inhibit"
import NightLight from "#/lib/nightLight"
import Hypridle from "#/lib/hypridle"
import Theming from "#/lib/theming"
import { app } from "#/App"
import { useSettings } from "#/lib/settings"
import WindowManager from "#/lib/windowManager"
import logger from "#/lib/logger"

export const openSettings = () => {
  let win = WindowManager.get_default().settings
  if (!win) {
    win = createSettingsWindow()
  }
  win.present()
}

export const widgets = () => {
  logger.log("widgets() starting...")
  const s = useSettings()
  Weather.get_default().init(s.weather)
  ColorScheme.get_default().init(Weather.get_default(), s.general)
  Inhibit.get_default().init(app)
  NightLight.get_default().init(s.general, ColorScheme.get_default())
  Hypridle.get_default().init(s.general)
  Theming.get_default().init(s.general)

  const safe = (name: string, fn: () => void) => {
    try {
      fn()
    } catch (e) {
      logger.log(`Widget ${name} failed to mount:`, e)
    }
  }

  // Register global keybindings with Hyprland
  KeybindsManager.get_default().register()

  safe("wallpaper", Wallpaper)
  logger.log("wallpaper mounted")
  safe("bar", bar)
  logger.log("bar mounted")
  safe("dock", dock)
  logger.log("dock mounted")
  safe("osd", osd)
  logger.log("osd mounted")
  safe("applauncher", applauncher)
  logger.log("applauncher mounted")
  safe("quicksettings", quicksettings)
  logger.log("quicksettings mounted")
  safe("lockscreen", LockScreen)
  logger.log("lockscreen mounted")
  safe("windowswitcher", windowswitcher)
  logger.log("windowswitcher mounted")
  safe("notifications", notifications)
  logger.log("notifications mounted")
  logger.log("widgets() done")
}
