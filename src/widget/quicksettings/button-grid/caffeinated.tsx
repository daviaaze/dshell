import Inhibit from "#/lib/inhibit"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const inhibit = Inhibit.get_default()

  const popover = (
    <Gtk.Popover>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => inhibit.idle = true}>
          <Adw.ButtonContent
            iconName="radio-checked-symbolic"
            label="Caffeinated on" />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.idle = false}>
          <Adw.ButtonContent
            iconName="radio-symbolic"
            label="Caffeinated off" />
        </Gtk.Button>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={createBinding(inhibit, "idle")
        .as(idle => idle ? ["suggested-action", "warning"] : [])}
      icon={createBinding(inhibit, "idle")
        .as(idle => idle ? "radio-checked-symbolic" : "radio-symbolic")}
      label={createBinding(inhibit, "idle")
        .as(idle => idle ? "Caffeinated on" : "Caffeinated off")}
      onClick={() => inhibit.idle = !inhibit.idle}
      popover={popover}
    />
  )
}
