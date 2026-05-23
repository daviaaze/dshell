import Inhibit from "#/lib/inhibit"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedPopoverBox } from "#/widget/common/linkedPopoverBox"

export default () => {
  const inhibit = Inhibit.get_default()
  const idle = createBinding(inhibit, "idle")
  const remaining = createBinding(inhibit, "remaining")

  const label = createComputed([idle, remaining], (idle, rem) => {
    if (!idle) return "Auto Sleep"
    return rem ? `Keep Awake (${rem})` : "Keep Awake"
  })

  const icon = createComputed([idle], (idle) =>
    idle ? "weather-clear-symbolic" : "weather-clear-night-symbolic",
  )

  const cssClasses = createComputed([idle], (idle) =>
    idle ? ["raised", "suggested-action"] : ["raised"],
  )

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedPopoverBox>
        <Gtk.Button onClicked={() => inhibit.setDuration(0)}>
          <Adw.ButtonContent
            iconName="emblem-ok-symbolic"
            label="Indefinitely"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(5)}>
          <Adw.ButtonContent
            iconName="emoji-recent-symbolic"
            label="5 minutes"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(15)}>
          <Adw.ButtonContent
            iconName="emoji-recent-symbolic"
            label="15 minutes"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(60)}>
          <Adw.ButtonContent
            iconName="emoji-recent-symbolic"
            label="1 hour"
          />
        </Gtk.Button>
        <Gtk.Separator visible={createBinding(inhibit, "idle")} />
        <Gtk.Button
          visible={createBinding(inhibit, "idle")}
          onClicked={() => (inhibit.idle = false)}
        >
          <Adw.ButtonContent
            iconName="window-close-symbolic"
            label="Turn Off"
          />
        </Gtk.Button>
      </LinkedPopoverBox>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={cssClasses}
      icon={icon}
      label={label}
      onClick={() => {
        if (inhibit.idle) inhibit.idle = false
        else inhibit.setDuration(0)
      }}
      popover={popover}
    />
  )
}
