import Gtk from "gi://Gtk?version=4.0"
import AstalIO from "gi://AstalIO?version=0.1"
import ShellState from "#/lib/shellState"
import logger from "#/lib/logger"

/** Reusable action button for power menu — reduces duplication. */
const ActionButton = (props: {
  iconName: string
  label: string
  destructive?: boolean
  action: () => void
  popover: Gtk.Popover
}) =>
  <Gtk.Button
    cssClasses={props.destructive ? ["flat", "destructive-action"] : ["flat"]}
    onClicked={() => {
      try {
        props.action()
      } catch (e) {
        logger.error("power", `Action "${props.label}" failed:`, e)
      }
      props.popover.popdown()
    }}>
    <Gtk.Box spacing={8}>
      <Gtk.Image iconName={props.iconName} />
      <Gtk.Label label={props.label} />
    </Gtk.Box>
  </Gtk.Button>

export const PowerMenu = () => {
  const popover = <Gtk.Popover
    cssClasses={["menu"]}>
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      cssClasses={["popover-padded-lg"]}>
      <ActionButton
        iconName="system-lock-screen-symbolic"
        label="Lock"
        popover={popover as Gtk.Popover}
        action={() => { ShellState.get_default().screenlocked = true }} />
      <ActionButton
        iconName="system-log-out-symbolic"
        label="Log Out"
        popover={popover as Gtk.Popover}
        action={() => {
          AstalIO.Process.exec_async("loginctl terminate-session", (_, res) => {
            try { AstalIO.Process.exec_async_finish(res) }
            catch (e) { logger.error("power", "loginctl failed:", e) }
          })
        }} />
      <ActionButton
        iconName="media-playback-pause-symbolic"
        label="Suspend"
        popover={popover as Gtk.Popover}
        action={() => {
          AstalIO.Process.exec_async("systemctl suspend", (_, res) => {
            try { AstalIO.Process.exec_async_finish(res) }
            catch (e) { logger.error("power", "systemctl suspend failed:", e) }
          })
        }} />
      <ActionButton
        iconName="system-reboot-symbolic"
        label="Reboot"
        popover={popover as Gtk.Popover}
        action={() => {
          AstalIO.Process.exec_async("systemctl reboot", (_, res) => {
            try { AstalIO.Process.exec_async_finish(res) }
            catch (e) { logger.error("power", "systemctl reboot failed:", e) }
          })
        }} />
      <ActionButton
        iconName="system-shutdown-symbolic"
        label="Power Off"
        destructive
        popover={popover as Gtk.Popover}
        action={() => {
          AstalIO.Process.exec_async("systemctl poweroff", (_, res) => {
            try { AstalIO.Process.exec_async_finish(res) }
            catch (e) { logger.error("power", "systemctl poweroff failed:", e) }
          })
        }} />
    </Gtk.Box>
  </Gtk.Popover> as Gtk.Popover

  return popover
}
