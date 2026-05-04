import ShellState from "#/lib/shellState";
import WindowManager from "#/lib/windowManager";
import Screenshot from "#/lib/screenshot";
import { openSettings } from "#/widget";
import { toggleWindowSwitcher } from "#/widget/windowswitcher";
import Gio from "gi://Gio?version=2.0";
import logger from "#/lib/logger"

export function registerActions(app: Gio.Application) {
  const state = ShellState.get_default()
  const wm = WindowManager.get_default()
  const screenshot = Screenshot.get_default()

  const actions: Record<string, () => void> = {
    "toggle-applauncher": () => state.toggleLauncher(),
    "toggle-quicksettings": () => state.toggleQuickSettings(),
    "toggle-bar": () => wm.bars.forEach(bar => bar.visible = !bar.visible),
    "toggle-windowswitcher": () => toggleWindowSwitcher(),
    "toggle-settings": () => openSettings(),
    "lockscreen": () => { state.screenlocked = true },
    "screenshot": () => screenshot.screenshot(true),
    "screenshot-area": () => screenshot.screenshot(false),
    "record": () => screenshot.toggleRecording(),
    "record-area": () => screenshot.recordArea(),
    "record-window": () => screenshot.recordWindow(),
    "record-output": () => screenshot.recordOutput(),
  }

  for (const [name, fn] of Object.entries(actions)) {
    const action = Gio.SimpleAction.new(name, null)
    action.connect("activate", fn)
    app.add_action(action)
  }
}

export const requestHandler =
  (cmd: Gio.ApplicationCommandLine, app: Gio.Application) => {
    const args = cmd.get_arguments()
    logger.log(`requestHandler args=${args.slice(1).join(" ")}`)

    const activate = (name: string) => {
      if (app.lookup_action(name)) {
        app.activate_action(name, null)
      } else {
        logger.warn(`unknown action: ${name}`)
      }
    }

    if (args[1] === "lockscreen")
      activate("lockscreen")
    else if (args[1] === "toggle")
      activate(`toggle-${args[2]}`)
    else if (args[1] === "screenshot")
      activate("screenshot")
    else if (args[1] === "screenshot-area")
      activate("screenshot-area")
    else if (args[1] === "record")
      activate("record")
    else if (args[1] === "record-area")
      activate("record-area")
    else if (args[1] === "record-window")
      activate("record-window")
    else if (args[1] === "record-output")
      activate("record-output")

    logger.log("requestHandler done")
    cmd.done()
  }
