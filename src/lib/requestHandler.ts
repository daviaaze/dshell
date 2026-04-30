import ShellState from "#/lib/shellState";
import WindowManager from "#/lib/windowManager";
import Screenshot from "#/lib/screenshot";
import { openSettings } from "#/widget";
import { toggleWindowSwitcher } from "#/widget/windowswitcher";
import Gio from "gi://Gio?version=2.0";

export const requestHandler =
  (cmd: Gio.ApplicationCommandLine) => {
    const args = cmd.get_arguments()
    const state = ShellState.get_default()

    if (args[1] === "lockscreen")
      state.screenlocked = true
    else if (args[1] === "toggle")
      switch (args[2]) {
        case "bar":
          WindowManager.get_default().bars.forEach(bar => bar.visible = !bar.visible)
          break
        case "applauncher":
          state.toggleLauncher()
          break
        case "quicksettings":
          state.toggleQuickSettings()
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

    cmd.done()
  }
