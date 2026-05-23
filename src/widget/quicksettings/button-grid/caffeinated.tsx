import Inhibit from "#/lib/inhibit"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const inhibit = Inhibit.get_default()

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => (inhibit.idle = true)}>
          <Adw.ButtonContent
            iconName="emblem-ok-symbolic"
            label="Keep Awake"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => (inhibit.idle = false)}>
          <Adw.ButtonContent
            iconName="window-close-symbolic"
            label="Allow Sleep"
          />
        </Gtk.Button>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={createBinding(inhibit, "idle").as((idle) =>
        idle ? ["raised", "suggested-action"] : ["raised"],
      )}
      icon={createBinding(inhibit, "idle").as((idle) =>
        idle ? "weather-clear-symbolic" : "weather-clear-night-symbolic",
      )}
      label={createBinding(inhibit, "idle").as((idle) =>
        idle ? "Caffeinated" : "Sleep Allowed",
      )}
      onClick={() => (inhibit.idle = !inhibit.idle)}
      popover={popover}
    />
  )
}
