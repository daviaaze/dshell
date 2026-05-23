import Gtk from "gi://Gtk?version=4.0"
import AstalIO from "gi://AstalIO?version=0.1"
import ShellState from "#/lib/shellState"
import logger from "#/lib/logger"
import { ActionButton } from "./actionButton.tsx"

export const PowerMenu = () => {
  const popover = (
    <Gtk.Popover cssClasses={["menu"]}>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={4}
        cssClasses={["popover-padded-lg"]}
      >
        <ActionButton
          iconName="system-lock-screen-symbolic"
          label="Lock"
          onClicked={() => {
            ShellState.get_default().screenlocked = true
            popover.popdown()
          }}
        />
        <ActionButton
          iconName="system-log-out-symbolic"
          label="Log Out"
          onClicked={() => {
            AstalIO.Process.exec_async(
              "loginctl terminate-session",
              (_, res) => {
                try {
                  AstalIO.Process.exec_async_finish(res)
                } catch (e) {
                  logger.error("power", "loginctl failed:", e)
                }
              },
            )
            popover.popdown()
          }}
        />
        <ActionButton
          iconName="media-playback-pause-symbolic"
          label="Suspend"
          onClicked={() => {
            AstalIO.Process.exec_async("systemctl suspend", (_, res) => {
              try {
                AstalIO.Process.exec_async_finish(res)
              } catch (e) {
                logger.error("power", "systemctl suspend failed:", e)
              }
            })
            popover.popdown()
          }}
        />
        <ActionButton
          iconName="system-reboot-symbolic"
          label="Reboot"
          onClicked={() => {
            AstalIO.Process.exec_async("systemctl reboot", (_, res) => {
              try {
                AstalIO.Process.exec_async_finish(res)
              } catch (e) {
                logger.error("power", "systemctl reboot failed:", e)
              }
            })
            popover.popdown()
          }}
        />
        <ActionButton
          iconName="system-shutdown-symbolic"
          label="Power Off"
          destructive
          onClicked={() => {
            AstalIO.Process.exec_async("systemctl poweroff", (_, res) => {
              try {
                AstalIO.Process.exec_async_finish(res)
              } catch (e) {
                logger.error("power", "systemctl poweroff failed:", e)
              }
            })
            popover.popdown()
          }}
        />
      </Gtk.Box>
    </Gtk.Popover>
  ) as Gtk.Popover

  return popover
}
