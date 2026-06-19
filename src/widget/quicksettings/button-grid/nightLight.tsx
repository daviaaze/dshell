import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { Slider } from "#/widget/common/slider"
import NightLight, { toPercent, toKelvin } from "#/lib/nightLight"

export default () => {
  const nightLight = NightLight.get_default()

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <Gtk.Box
        cssClasses={["toolbar", "linked", "popover-padded"]}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
      >
        <Slider
          icon="night-light-symbolic"
          min={0}
          max={100}
          value={createBinding(nightLight, "temperature").as((t) =>
            toPercent(t),
          )}
          setValue={(v) => (nightLight.temperature = toKelvin(v))}
        />
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
