import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import Hypridle from "#/lib/hypridle"

export default () => {
  const hypridle = Hypridle.get_default()

  const popover = (
    <Gtk.Popover>
      <Gtk.Box
        cssClasses={["toolbar"], ["linked"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        marginTop={8}
        marginBottom={8}
        marginStart={8}
        marginEnd={8}>
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
          <Gtk.Label label="Lock after" />
          <Gtk.Scale
            hexpand
            digits={0}
            adjustment={
              <Gtk.Adjustment
                lower={60}
                upper={1800}
                stepIncrement={30}
                value={createBinding(hypridle, "idleTimeout")}
              /> as Gtk.Adjustment}
            onValueChanged={self =>
              hypridle.idleTimeout = self.get_value()}
          />
          <Gtk.Label
            label={createBinding(hypridle, "idleTimeout")
              .as(t => `${Math.round(t / 60)}m`)}
            cssClasses={["caption"]} />
        </Gtk.Box>
        <Gtk.Separator />
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
          <Gtk.Label label="Dim before lock" hexpand />
          <Gtk.Switch
            active={createBinding(hypridle, "dimEnabled")}
            onNotifyActive={self =>
              hypridle.dimEnabled = self.active} />
        </Gtk.Box>
      </Gtk.Box>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={createBinding(hypridle, "enabled")
        .as(e => e ? ["raised"] : ["raised", "flat"])}
      icon={createBinding(hypridle, "enabled")
        .as(e => e ? "system-lock-screen-symbolic" : "system-unlock-screen-symbolic")}
      label={createBinding(hypridle, "enabled")
        .as(e => e ? "Auto Lock" : "Auto Lock Off")}
      onClick={() => hypridle.enabled = !hypridle.enabled}
      popover={popover}
    />
  )
}
