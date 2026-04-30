import Gtk from "gi://Gtk?version=4.0"
import AstalIO from "gi://AstalIO?version=0.1"
import ShellState from "#/lib/shellState"

export const PowerMenu = () => {
  const popover = <Gtk.Popover
    cssClasses={["menu"]}>
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
      css={"padding: 12px;"}>
      <Gtk.Button
        cssClasses={["flat"]} 
        onClicked={() => {
          ShellState.get_default().screenlocked = true
          popover.popdown()
        }}>
        <Gtk.Box spacing={8}>
          <Gtk.Image iconName="system-lock-screen-symbolic" />
          <Gtk.Label label="Lock" />
        </Gtk.Box>
      </Gtk.Button>
      <Gtk.Button
        cssClasses={["flat"]} 
        onClicked={() => {
          AstalIO.Process.exec_async("loginctl terminate-session", () => {})
          popover.popdown()
        }}>
        <Gtk.Box spacing={8}>
          <Gtk.Image iconName="system-log-out-symbolic" />
          <Gtk.Label label="Log Out" />
        </Gtk.Box>
      </Gtk.Button>
      <Gtk.Button
        cssClasses={["flat"]} 
        onClicked={() => {
          AstalIO.Process.exec_async("systemctl suspend", () => {})
          popover.popdown()
        }}>
        <Gtk.Box spacing={8}>
          <Gtk.Image iconName="media-playback-pause-symbolic" />
          <Gtk.Label label="Suspend" />
        </Gtk.Box>
      </Gtk.Button>
      <Gtk.Button
        cssClasses={["flat"]} 
        onClicked={() => {
          AstalIO.Process.exec_async("systemctl reboot", () => {})
          popover.popdown()
        }}>
        <Gtk.Box spacing={8}>
          <Gtk.Image iconName="system-reboot-symbolic" />
          <Gtk.Label label="Reboot" />
        </Gtk.Box>
      </Gtk.Button>
      <Gtk.Button
        cssClasses={["flat", "destructive-action"]} 
        onClicked={() => {
          AstalIO.Process.exec_async("systemctl poweroff", () => {})
          popover.popdown()
        }}>
        <Gtk.Box spacing={8}>
          <Gtk.Image iconName="system-shutdown-symbolic" />
          <Gtk.Label label="Power Off" />
        </Gtk.Box>
      </Gtk.Button>
    </Gtk.Box>
  </Gtk.Popover> as Gtk.Popover

  return popover
}
