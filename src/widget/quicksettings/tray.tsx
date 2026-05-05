import { useSettings } from "#/lib/settings"
import Tray from "gi://AstalTray"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, createBinding, For } from "gnim"
import ShellState from "#/lib/shellState"
import { PowerMenu } from "#/widget/common/powerMenu"
import { IconButton, IconMenuButton } from "#/widget/common/iconButton"
import { openSettings } from "#/widget"
import logger from "#/lib/logger"
import { usePopoverCleanup } from "#/widget/common/popoverCleanup"

export const TrayBox = () => {
  logger.log("Tray: get_default()...")
  const tray = Tray.get_default()
  logger.log("Tray: done")

  const LockButton = () => (
    <IconButton
      icon="system-lock-screen-symbolic"
      onClicked={() => {
        ShellState.get_default().screenlocked = true
      }}
    />
  )

  const PowerButton = () => {
    const menu = PowerMenu()
    return <IconMenuButton
      icon="system-shutdown-symbolic"
      cssClasses={["destructive-action"]}
      popover={menu}
    />
  }

  const RotateButton = () => {
    const barCfg = useSettings().bar
    return <IconButton
      icon="object-rotate-right-symbolic"
      onClicked={() => {
        if ((barCfg.position as Accessor<any>).get() > 8)
          barCfg.setPosition(2)
        else
          barCfg.setPosition(
            (barCfg.position as Accessor<any>).get() * 2)
      }}
    />
  }

  const SettingsButton = () => (
    <IconButton
      icon="preferences-system-symbolic"
      onClicked={() => {
        openSettings()
        ShellState.get_default().qsOpen = false
      }}
    />
  )

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
            usePopoverCleanup(self)
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
