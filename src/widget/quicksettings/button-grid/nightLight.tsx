import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import NightLight from "#/lib/nightLight"

export default () => {
  const nightLight = NightLight.get_default()

  return <Adw.SplitButton
    cssClasses={createBinding(nightLight, "enabled")
      .as(e => e ? ["raised", "suggested-action"] : ["raised"])}
    widthRequest={150}
    onClicked={() => {
      nightLight.enabled = !nightLight.enabled
    }}
    popover={
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
            <Gtk.Label label="Temperature" />
            <Gtk.Scale
              hexpand
              digits={0}
              adjustment={
                <Gtk.Adjustment
                  lower={2000}
                  upper={6500}
                  stepIncrement={100}
                  value={createBinding(nightLight, "temperature")}
                /> as Gtk.Adjustment}
              onValueChanged={self =>
                nightLight.temperature = self.get_value()}
            />
            <Gtk.Label
              label={createBinding(nightLight, "temperature")
                .as(t => `${t}K`)}
              cssClasses={["caption"]} />
          </Gtk.Box>
          <Gtk.Separator />
          <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
            <Gtk.Label label="Auto Schedule" hexpand />
            <Gtk.Switch
              active={createBinding(nightLight, "autoSchedule")}
              onNotifyActive={self =>
                nightLight.autoSchedule = self.active} />
          </Gtk.Box>
        </Gtk.Box>
      </Gtk.Popover> as Gtk.Popover}
  >
    <Adw.ButtonContent
      iconName={createBinding(nightLight, "enabled")
        .as(e => e ? "night-light-symbolic" : "night-light-disabled-symbolic")}
      label="Night Light"
    />
  </Adw.SplitButton>
}
