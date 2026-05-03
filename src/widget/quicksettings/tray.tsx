import { useSettings } from "#/lib/settings";
import AstalIO from "gi://AstalIO?version=0.1";
import Tray from "gi://AstalTray";
import Gtk from "gi://Gtk?version=4.0";
import { Accessor, createBinding, For } from "gnim";
import ShellState from "#/lib/shellState";
import { PowerMenu } from "#/widget/common/powerMenu";
import { openSettings } from "#/widget";
import logger from "#/lib/logger"

export const TrayBox = () => {
  logger.log("Tray: get_default()...")
  const tray = Tray.get_default();
  logger.log("Tray: done")

  const LockButton = () => (
    <Gtk.Button
      cssClasses={["circular"]}
      onClicked={() => {
        ShellState.get_default().screenlocked = true
      }}
    >
      <Gtk.Image iconName={"system-lock-screen-symbolic"} />
    </Gtk.Button>
  );

  const PowerButton = () => {
    const menu = PowerMenu()
    return <Gtk.MenuButton
      cssClasses={["circular", "destructive-action"]}
      popover={menu}
      $={self => {
        self.connect("destroy", () => {
          if (menu.parent) menu.unparent()
        })
      }}>
      <Gtk.Image iconName={"system-shutdown-symbolic"} />
    </Gtk.MenuButton>
  };

  const RotateButton = () => {
    const barCfg = useSettings().bar
    return <Gtk.Button
      cssClasses={["circular"]}
      onClicked={() => {
        if ((barCfg.position as Accessor<any>).get() > 8)
          barCfg.setPosition(2)
        else
          barCfg.setPosition(
            (barCfg.position as Accessor<any>).get() * 2)
      }}>
      <Gtk.Image iconName={"object-rotate-right-symbolic"} />
    </Gtk.Button>
  }

  const SettingsButton = () => <Gtk.Button
    cssClasses={["circular"]}
    onClicked={() => {
      openSettings()
      ShellState.get_default().qsOpen = false;
    }}>
    <Gtk.Image iconName={"preferences-system-symbolic"} />
  </Gtk.Button>

  return <Gtk.Box
    spacing={4}
    homogeneous
    halign={Gtk.Align.CENTER}>
    <For each={createBinding(tray, "items")}>
      {((item: Tray.TrayItem) =>
        <Gtk.MenuButton
          cssClasses={["circular"]}
          $={self => {
            self.insert_action_group("dbusmenu", item.actionGroup)
          }}
          popover={undefined}
          menuModel={item.menuModel}
          tooltip_markup={createBinding(item, "tooltip_markup")}>
          <Gtk.Image visible={!!item.gicon} gicon={item.gicon} />
        </Gtk.MenuButton>
      )}
    </For>
    <SettingsButton />
    <RotateButton />
    <LockButton />
    <PowerButton />
  </Gtk.Box>
}