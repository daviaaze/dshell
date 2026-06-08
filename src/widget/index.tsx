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
import { ColorScheme } from "#/lib/colorScheme"
import Inhibit from "#/lib/inhibit"
import NightLight from "#/lib/nightLight"
import Hypridle from "#/lib/hypridle"
import Touchpad from "#/lib/touchpad"
import Theming from "#/lib/theming"
import NotificationHistory from "#/lib/notificationHistory"
import TimerService from "./quicksettings/timer/TimerService"
import { initAutoSwitch } from "#/lib/audioAutoSwitch"
import { app } from "#/App"
import { useSettings } from "#/lib/settings"
import WindowManager from "#/lib/windowManager"
import logger, { perf } from "#/lib/logger"

export const openSettings = () => {
  const win = WindowManager.get_default().settings
  logger.debug("app", `openSettings: win=${win ? "found" : "NULL"}`)
  if (win) {
    logger.debug("app", `openSettings: calling present() on ${win.name}`)
    win.present()
  } else {
    logger.error("app", "openSettings: no settings window registered")
  }
}

export const widgets = () => {
  perf.start("services-init", "mount")
  logger.log("widgets() starting...")
  const s = useSettings()
  Weather.get_default().init(s.weather)
  ColorScheme.get_default().init(Weather.get_default(), s.general)
  Inhibit.get_default().init(app)
  NightLight.get_default().init(s.general, ColorScheme.get_default())
  Hypridle.get_default().init(s.general)
  try {
    Touchpad.get_default().init()
  } catch (e) {
    logger.warn("mount", "Touchpad init skipped (no touchpad?):", e)
  }
  Theming.get_default().init(s.general)
  NotificationHistory.get_default().init(s.general)
  initAutoSwitch()
  TimerService.get_default().init(
    app,
    s.timer.pomodoroWorkDuration.get(),
    s.timer.pomodoroBreakDuration.get(),
    s.timer.pomodoroLongBreakDuration.get(),
    s.timer.pomodoroSessionsBeforeLongBreak.get(),
  )
  perf.stop("services-init", "mount")

  const safe = (name: string, fn: () => void) => {
    perf.start(`widget-${name}`, "mount")
    try {
      fn()
      logger.info(
        "mount",
        `${name} mounted in ${perf.stop(`widget-${name}`, "mount").toFixed(1)}ms`,
      )
    } catch (e) {
      logger.error("mount", `Widget ${name} FAILED to mount:`, e)
    }
  }

  safe("wallpaper", Wallpaper)
  safe("bar", bar)
  safe("dock", dock)
  safe("osd", osd)
  safe("applauncher", applauncher)
  safe("quicksettings", quicksettings)
  safe("lockscreen", LockScreen)
  safe("windowswitcher", windowswitcher)
  safe("notifications", notifications)
  safe("settings", () => {
    const win = createSettingsWindow()
    WindowManager.get_default().setSettings(win)
  })
  logger.log("widgets() done")
  perf.stop("widgets-mount", "mount")
}
