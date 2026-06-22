import ShellState from "#/lib/shellState"
import WindowManager from "#/lib/windowManager"
import Screenshot from "#/lib/screenshot"
import Touchpad from "#/lib/touchpad"
import { openSettings } from "#/widget"
import { toggleWindowSwitcher } from "#/widget/windowswitcher"
import Gio from "gi://Gio?version=2.0"
import logger from "#/lib/logger"

export function registerActions(app: Gio.Application) {
  const state = ShellState.get_default()
  const wm = WindowManager.get_default()
  const screenshot = Screenshot.get_default()
  const touchpad = Touchpad.get_default()

  const actions: Record<string, () => void> = {
    "toggle-applauncher": () => state.toggleLauncher(),
    "toggle-quicksettings": () => state.toggleQuickSettings(),
    "toggle-bar": () => wm.bars.forEach((bar) => (bar.visible = !bar.visible)),
    "toggle-windowswitcher": () => toggleWindowSwitcher(),
    "toggle-settings": () => openSettings(),
    "toggle-clipboard": () => state.toggleClipboard(),
    "open-clipboard": () => state.openClipboard(),
    lockscreen: () => {
      state.screenlocked = true
    },
    screenshot: () => screenshot.screenshot(true),
    "screenshot-area": () => screenshot.screenshot(false),
    "screenshot-overlay": () => screenshot.toggleOverlay(),
    record: () => screenshot.toggleRecording(),
    "record-area": () => screenshot.recordArea(),
    "record-window": () => screenshot.recordWindow(),
    "record-output": () => screenshot.recordOutput(),
    "toggle-touchpad": () => touchpad.toggle(),
  }

  for (const [name, fn] of Object.entries(actions)) {
    const action = Gio.SimpleAction.new(name, null)
    action.connect("activate", fn)
    app.add_action(action)
  }
}

export const requestHandler = (
  cmd: Gio.ApplicationCommandLine,
  app: Gio.Application,
) => {
  const args = cmd.get_arguments()
  logger.debug("dbus", `requestHandler args=${args.slice(1).join(" ")}`)

  const activate = (name: string) => {
    if (app.lookup_action(name)) {
      app.activate_action(name, null)
    } else {
      logger.warn("dbus", `unknown action: ${name}`)
    }
  }

  if (args[1] === "lockscreen") activate("lockscreen")
  else if (args[1] === "toggle") activate(`toggle-${args[2]}`)
  else if (args[1] === "clipboard") activate("toggle-clipboard")
  else if (args[1] === "screenshot") activate("screenshot")
  else if (args[1] === "screenshot-area") activate("screenshot-area")
  else if (args[1] === "screenshot-overlay") activate("screenshot-overlay")
  else if (args[1] === "record") activate("record")
  else if (args[1] === "record-area") activate("record-area")
  else if (args[1] === "record-window") activate("record-window")
  else if (args[1] === "record-window-address" && args[2]) screenshot.recordWindowByAddress(args[2])
  else if (args[1] === "record-output" && args[2]) screenshot.recordOutput(args[2])
  else if (args[1] === "record-output") activate("record-output")
  else if (args[1] === "touchpad") activate("toggle-touchpad")

  logger.debug("dbus", "requestHandler done")
  cmd.done()
}
