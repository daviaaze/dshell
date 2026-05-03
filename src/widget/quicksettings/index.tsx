import Hyprland from "gi://AstalHyprland"
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { createBinding } from "gnim";
import { app } from "#/App";
import WindowManager from "#/lib/windowManager";
import { useSettings } from "../../lib/settings";
import logger from "#/lib/logger";
import { NotificationList } from "./notificationList";
import { TrayBox } from "./tray";
import { AudioConfig, BrightnessSlider, MicConfig } from "./sliders";
import AppMixer from "./appMixer";
import { ButtonGrid } from "./button-grid";
import { Expander } from "./expander";
import ShellState from "#/lib/shellState"

export default () => {

  const barCfg = useSettings().bar
  const hyprland = Hyprland.get_default()
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  return <Astal.Window
    $={self => {
      WindowManager.get_default().setQuicksettings(self)
      self.connect("realize", () => logger.log("quicksettings realized"))
      self.connect("map", () => logger.log("quicksettings mapped"))
    }}
    margin={12}
    application={app}
    name={"quicksettings"}
    visible={createBinding(ShellState.get_default(), "qsOpen")}
    onNotifyVisible={self => {
      logger.log(`quicksettings visible -> ${self.visible}`)
      if ((barCfg.position.get() === LEFT ||
        barCfg.position.get() === RIGHT)
        && self.visible && ShellState.get_default().launcherOpen)
        ShellState.get_default().launcherOpen = false
      ShellState.get_default().qsOpen = self.visible
    }}
    cssClasses={["card", "frame", "background"]}
    anchor={barCfg.position.as(p =>
      TOP | (p === LEFT ? LEFT : RIGHT) | BOTTOM
    )}
    widthRequest={420}
    monitor={createBinding(hyprland, "focusedMonitor")
      .as(m => m.id)}>
    <Gtk.ScrolledWindow
      propagateNaturalHeight
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      vexpand>
      <Gtk.Box spacing={8}
        cssClasses={["popover-padded-lg"]}
        orientation={Gtk.Orientation.VERTICAL}>
        <ButtonGrid />
        <BrightnessSlider />
        <AudioConfig />
        <AppMixer />
        <MicConfig />
        <TrayBox />
        <Expander />
        <NotificationList />
      </Gtk.Box>
    </Gtk.ScrolledWindow>
  </Astal.Window>
}
