import { app } from "#/App";
import { launcherOpen, qsOpen, setLauncherOpen, setQsOpen } from "#/widget";
import { setScreelocked } from "#/widget";
import Screenshot from "#/lib/screenshot";
import Gio from "gi://Gio?version=2.0";

export const requestHandler =
  (cmd: Gio.ApplicationCommandLine) => {
    const args = cmd.get_arguments()

    if (args[1] === "lockscreen")
      setScreelocked(true)
    else if (args[1] === "toggle")
      switch (args[2]) {
        case "bar":
          app.bar.forEach(bar => bar.visible = !bar.visible)
          break
        case "applauncher":
          setLauncherOpen(!launcherOpen.get())
          break
        case "quicksettings":
          setQsOpen(!qsOpen.get())
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
