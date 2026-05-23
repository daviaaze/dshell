import Powerprofiles from "gi://AstalPowerProfiles"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const [iconName, setIconName] = createState("power-profile-balanced-symbolic")
  const [label, setLabel] = createState("Balanced")
  let profile: Powerprofiles | null = null

  onMount(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      profile = Powerprofiles.get_default()
      const update = () => {
        if (!profile) return
        setIconName(profile.iconName ?? "")
        const p = profile.activeProfile
        setLabel(
          p === "power-saver" ? "Power Saver"
          : p === "balanced" ? "Balanced"
          : "Performance",
        )
      }
      update()
      profile.connect("notify::iconName", update)
      profile.connect("notify::activeProfile", update)
      return GLib.SOURCE_REMOVE
    })
  })

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => profile?.set_active_profile("power-saver")}>
          <Adw.ButtonContent
            iconName="power-profile-power-saver-symbolic"
            label="Power Saver"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => profile?.set_active_profile("balanced")}>
          <Adw.ButtonContent
            iconName="power-profile-balanced-symbolic"
            label="Balanced"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => profile?.set_active_profile("performance")}>
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
      icon={iconName}
      label={label}
      onClick={() => {
        if (!profile) return
        const p = profile.get_active_profile()
        if (p === "power-saver") profile.set_active_profile("balanced")
        else if (p === "balanced") profile.set_active_profile("performance")
        else profile.set_active_profile("power-saver")
      }}
      popover={popover}
    />
  )
}
