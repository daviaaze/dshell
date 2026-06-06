import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { createState, onMount } from "gnim"
import PowerProfiles, { profileLabel, nextProfile } from "#/lib/powerProfiles"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const [iconName, setIconName] = createState("power-profile-balanced-symbolic")
  const [label, setLabel] = createState("Balanced")
  const [activeProfile, setActiveProfile] = createState("balanced")
  const pp = PowerProfiles.get_default()

  onMount(() => {
    const update = () => {
      const p = pp.activeProfile
      setActiveProfile(p)
      setIconName(pp.iconName)
      setLabel(profileLabel(p))
    }
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      update()
      pp.connect("notify::activeProfile", update)
      return GLib.SOURCE_REMOVE
    })
  })

  const setProfile = (p: "power-saver" | "balanced" | "performance") => {
    pp.set_active_profile(p)
  }

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => setProfile("power-saver")}>
          <Adw.ButtonContent
            iconName="power-profile-power-saver-symbolic"
            label="Power Saver"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => setProfile("balanced")}>
          <Adw.ButtonContent
            iconName="power-profile-balanced-symbolic"
            label="Balanced"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => setProfile("performance")}>
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
      onClick={() => setProfile(nextProfile(activeProfile()))}
      popover={popover}
    />
  )
}
