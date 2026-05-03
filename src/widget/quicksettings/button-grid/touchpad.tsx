import Touchpad from "#/lib/touchpad"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"

export default () => {
  const touchpad = Touchpad.get_default()
  return <Adw.SplitButton
    cssClasses={createBinding(touchpad, "disabled")
      .as(disabled => disabled ? ["warning"] : [])}
    popover={
      <Gtk.Popover cssClasses={[]}>
        <Gtk.Box
          cssClasses={["linked"]}
          orientation={Gtk.Orientation.VERTICAL}>
          <Gtk.Button onClicked={() => {
            if (touchpad.disabled) touchpad.toggle()
          }}>
            <Adw.ButtonContent
              iconName={"radio-checked-symbolic"}
              label="Touchpad On" />
          </Gtk.Button>
          <Gtk.Button onClicked={() => {
            if (!touchpad.disabled) touchpad.toggle()
          }}>
            <Adw.ButtonContent
              iconName={"radio-symbolic"}
              label="Touchpad Off" />
          </Gtk.Button>
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}
    hexpand
    $={self => {
      self.connect("clicked", () => {
        touchpad.toggle()
      })
      self.connect("destroy", () => {
        const popover = self.popover
        if (popover?.parent) popover.unparent()
      })
    }}>
    <Adw.ButtonContent
      iconName={createBinding(touchpad, "disabled")
        .as(disabled => disabled ?
          "touchpad-disabled-symbolic" :
          "input-touchpad-symbolic")}
      label={createBinding(touchpad, "disabled")
        .as(disabled => disabled ?
          "Touchpad Off" :
          "Touchpad On")} />
  </Adw.SplitButton>
}
