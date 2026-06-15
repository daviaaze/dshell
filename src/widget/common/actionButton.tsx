import Gtk from "gi://Gtk?version=4.0"
import Adw from "gi://Adw?version=1"

/**
 * A button with an icon and label, styled as a flat menu item.
 * Use for popover menus, context menus, and action lists.
 *
 * Uses Adw.ButtonContent as child to avoid gtk_button_set_child assertion
 * when Gnim re-renders the parent — ButtonContent handles its own lifecycle.
 *
 * @example
 * <ActionButton iconName="system-shutdown" label="Power Off" destructive
 *   onClicked={() => { doPoweroff(); popover.popdown() }} />
 */
export const ActionButton = (props: {
  iconName: string
  label: string
  destructive?: boolean
  visible?: boolean | import("gnim").Accessor<boolean>
  onClicked: () => void
}) => (
  <Gtk.Button
    visible={props.visible ?? true}
    cssClasses={props.destructive ? ["flat", "destructive-action"] : ["flat"]}
    onClicked={props.onClicked}
  >
    <Adw.ButtonContent iconName={props.iconName} label={props.label} />
  </Gtk.Button>
)
