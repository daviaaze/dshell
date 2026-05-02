import ShellState from "#/lib/shellState";
import WindowManager from "#/lib/windowManager";
import Screenshot from "#/lib/screenshot";
import { openSettings } from "#/widget";
import { toggleWindowSwitcher } from "#/widget/windowswitcher";
import Gio from "gi://Gio?version=2.0";
import logger from "#/lib/logger"

export const requestHandler =
  (cmd: Gio.ApplicationCommandLine) => {
    const args = cmd.get_arguments()
    const state = ShellState.get_default()

    logger.log(`requestHandler args=${args.slice(1).join(" ")}`)

    if (args[1] === "lockscreen")
      state.screenlocked = true
    else if (args[1] === "toggle")
      switch (args[2]) {
        case "bar":
          WindowManager.get_default().bars.forEach(bar => bar.visible = !bar.visible)
          break
        case "applauncher":
          logger.log("toggling launcher")
          state.toggleLauncher()
          logger.log("toggleLauncher() returned")
          break
        case "quicksettings":
          logger.log("toggling quicksettings")
          state.toggleQuickSettings()
          logger.log("toggleQuickSettings() returned")
          break
        case "settings":
          openSettings()
          break
        case "windowswitcher":
          toggleWindowSwitcher()
          break
      }
    else if (args[1] === "screenshot")
      Screenshot.get_default().screenshot(true)
    else if (args[1] === "screenshot-area")
      Screenshot.get_default().screenshot(false)
    else if (args[1] === "record")
      Screenshot.get_default().toggleRecording()
    else if (args[1] === "record-area")
      Screenshot.get_default().recordArea()
    else if (args[1] === "record-window")
      Screenshot.get_default().recordWindow()
    else if (args[1] === "record-output")
      Screenshot.get_default().recordOutput()

    logger.log("requestHandler done")
    cmd.done()
  }
