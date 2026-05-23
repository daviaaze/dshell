import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import ShellState from "#/lib/shellState"
import { Accessor, createBinding } from "gnim"

export default ({
  visible = true,
}: {
  visible?: boolean | Accessor<boolean>
}) => {
  return (
    <Gtk.ToggleButton
      visible={visible}
      cursor={Gdk.Cursor.new_from_name("pointer", null)}
      active={createBinding(ShellState.get_default(), "launcherOpen")}
      onClicked={() => ShellState.get_default().toggleLauncher()}
    >
      <Gtk.Image iconName={"nix-snowflake"} pixelSize={24} />
    </Gtk.ToggleButton>
  )
}
