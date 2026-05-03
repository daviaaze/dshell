import Touchpad from "#/lib/touchpad"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const touchpad = Touchpad.get_default()

  const popover = (
    <Gtk.Popover>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => {
          if (touchpad.disabled) touchpad.toggle()
        }}>
          <Adw.ButtonContent
            iconName="radio-checked-symbolic"
            label="Touchpad On" />
        </Gtk.Button>
        <Gtk.Button onClicked={() => {
          if (!touchpad.disabled) touchpad.toggle()
        }}>
          <Adw.ButtonContent
            iconName="radio-symbolic"
            label="Touchpad Off" />
        </Gtk.Button>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={createBinding(touchpad, "disabled")
        .as(disabled => disabled ? ["warning"] : [])}
      icon={createBinding(touchpad, "disabled")
        .as(disabled => disabled
          ? "touchpad-disabled-symbolic"
          : "input-touchpad-symbolic")}
      label={createBinding(touchpad, "disabled")
        .as(disabled => disabled ? "Touchpad Off" : "Touchpad On")}
      onClick={() => touchpad.toggle()}
      popover={popover}
    />
  )
}
