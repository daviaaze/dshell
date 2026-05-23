import Gtk from "gi://Gtk?version=4.0"

/**
 * A button with an icon and label, styled as a flat menu item.
 * Use for popover menus, context menus, and action lists.
 *
 * @example
 * <ActionButton iconName="system-shutdown" label="Power Off" destructive
 *   onClicked={() => { doPoweroff(); popover.popdown() }} />
 */
export const ActionButton = (props: {
  iconName: string
  label: string
  destructive?: boolean
  onClicked: () => void
}) => (
  <Gtk.Button
    cssClasses={props.destructive ? ["flat", "destructive-action"] : ["flat"]}
    onClicked={props.onClicked}
  >
    <Gtk.Box spacing={8}>
      <Gtk.Image iconName={props.iconName} />
      <Gtk.Label label={props.label} />
    </Gtk.Box>
  </Gtk.Button>
)
