import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import NightLight, { TEMP_MIN, TEMP_MAX } from "#/lib/nightLight"

export default () => {
  const nightLight = NightLight.get_default()

  const popover = (
    <Gtk.Popover cssClasses={[]} hasArrow={false}>
      <Gtk.Box
        cssClasses={["toolbar", "linked", "popover-padded"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
      >
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
          <Gtk.Label label="Temperature" />
          <Gtk.Scale
            widthRequest={150}
            digits={0}
            roundDigits={0}
            adjustment={
              (
                <Gtk.Adjustment
                  lower={TEMP_MIN}
                  upper={TEMP_MAX}
                  stepIncrement={100}
                  value={createBinding(nightLight, "temperature")}
                />
              ) as Gtk.Adjustment
            }
            onValueChanged={(self) =>
              (nightLight.temperature = Math.round(self.get_value()))
            }
          />
          <Gtk.Label
            widthChars={5}
            label={createBinding(nightLight, "temperature").as((t) => `${t}K`)}
            cssClasses={["caption"]}
          />
        </Gtk.Box>
        <Gtk.Separator />
        <Gtk.Box spacing={8} valign={Gtk.Align.CENTER}>
          <Gtk.Label label="Auto Schedule" hexpand />
          <Gtk.Switch
            active={createBinding(nightLight, "autoSchedule")}
            onNotifyActive={(self) => (nightLight.autoSchedule = self.active)}
          />
        </Gtk.Box>
      </Gtk.Box>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={createBinding(nightLight, "enabled").as((e) =>
        e ? ["raised", "suggested-action"] : ["raised"],
      )}
      icon={createBinding(nightLight, "enabled").as((e) =>
        e ? "night-light-symbolic" : "night-light-disabled-symbolic",
      )}
      label="Night Light"
      onClick={() => (nightLight.enabled = !nightLight.enabled)}
      popover={popover}
    />
  )
}
