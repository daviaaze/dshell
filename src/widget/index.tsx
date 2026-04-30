import applauncher from "./applauncher"
import bar from "./bar"
import dock from "./dock"
import { LockScreen } from "./lockscreen"
import notifications from "./notifications"
import osd from "./osd"
import quicksettings from "./quicksettings"
import windowswitcher from "./windowswitcher"
import dock from "./dock"
import { createSettingsWindow } from "./settings"
import { Wallpaper } from "./wallpaper"
import Weather from "#/lib/weather"
import { ColorScheme } from "#/lib/colorScheme"
import Inhibit from "#/lib/inhibit"
import NightLight from "#/lib/nightLight"
import Hypridle from "#/lib/hypridle"
import Theming from "#/lib/theming"
import { app } from "#/App"
import { useSettings } from "#/lib/settings"
import WindowManager from "#/lib/windowManager"

export const openSettings = () => {
  let win = WindowManager.get_default().settings
  if (!win) {
    win = createSettingsWindow()
  }
  win.present()
}

export const widgets = () => {
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
      print(`[Shade] Widget ${name} failed to mount:`, e)
    }
  }

  safe("wallpaper", Wallpaper)
  safe("bar", bar)
  safe("dock", dock)
  safe("osd", osd)
  safe("applauncher", applauncher)
  safe("notifications", notifications)
  safe("quicksettings", quicksettings)
  safe("lockscreen", LockScreen)
  safe("windowswitcher", windowswitcher)
  safe("dock", dock)
}