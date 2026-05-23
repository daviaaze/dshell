import Powerprofiles from "gi://AstalPowerProfiles"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"
import logger from "#/lib/logger"

export default () => {
  logger.log("Powerprofiles: get_default()...")
  const profile = Powerprofiles.get_default()
  logger.log("Powerprofiles: get_default() done")

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => profile.set_active_profile("power-saver")}>
          <Adw.ButtonContent
            iconName="power-profile-power-saver-symbolic"
            label="Power Saver"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => profile.set_active_profile("balanced")}>
          <Adw.ButtonContent
            iconName="power-profile-balanced-symbolic"
            label="Balanced"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => profile.set_active_profile("performance")}>
          <Adw.ButtonContent
            iconName="power-profile-performance-symbolic"
            label="Performance"
          />
        </Gtk.Button>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      icon={createBinding(profile, "iconName").as((i) => i ?? "")}
      label={createBinding(profile, "activeProfile").as((p) =>
        p === "power-saver"
          ? "Power Saver"
          : p === "balanced"
            ? "Balanced"
            : "Performance",
      )}
      onClick={() => {
        const p = profile.get_active_profile()
        if (p === "power-saver") profile.set_active_profile("balanced")
        else if (p === "balanced") profile.set_active_profile("performance")
        else profile.set_active_profile("power-saver")
      }}
      popover={popover}
    />
  )
}
