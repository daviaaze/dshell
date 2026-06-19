import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, JSX } from "gnim"
import { usePopoverCleanup } from "./popoverCleanup"

interface QuickToggleButtonProps {
  icon: Accessor<string> | string
  label: Accessor<string> | string
  cssClasses?: Accessor<string[]> | string[]
  onClick?: () => void
  popover?: Gtk.Popover | JSX.Element
  hexpand?: boolean
  visible?: Accessor<boolean> | boolean
}

export const QuickToggleButton = (props: QuickToggleButtonProps) => {
  if (props.popover) {
    return (
      <Adw.SplitButton
        visible={props.visible ?? true}
        cssClasses={props.cssClasses ?? ["raised"]}
        hexpand={props.hexpand ?? true}
        $={usePopoverCleanup}
        onClicked={props.onClick}
        popover={props.popover}
      >
        <Adw.ButtonContent iconName={props.icon} label={props.label} />
      </Adw.SplitButton>
    )
  }
  return (
    <Gtk.Button
      visible={props.visible ?? true}
      cssClasses={props.cssClasses ?? ["raised"]}
      hexpand={props.hexpand ?? true}
      onClicked={props.onClick}
    >
      <Adw.ButtonContent iconName={props.icon} label={props.label} />
    </Gtk.Button>
  )
}
