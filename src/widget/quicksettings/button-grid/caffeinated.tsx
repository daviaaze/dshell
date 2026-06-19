import Inhibit from "#/lib/inhibit"
import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { LinkedBox } from "#/widget/common/linkedBox"

export default () => {
  const inhibit = Inhibit.get_default()
  const idle = createBinding(inhibit, "idle")
  const remaining = createBinding(inhibit, "remaining")

  const label = createComputed(() => {
    const _idle = idle()
    const rem = remaining()
    if (!_idle) return "Auto Sleep"
    return rem ? `Keep Awake (${rem})` : "Keep Awake"
  })

  const icon = createComputed(() =>
    idle() ? "weather-clear-symbolic" : "weather-clear-night-symbolic",
  )

  const cssClasses = createComputed(() =>
    idle() ? ["raised", "suggested-action"] : ["raised"],
  )

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <LinkedBox>
        <Gtk.Button onClicked={() => inhibit.setDuration(0)}>
          <Adw.ButtonContent
            iconName="list-add-symbolic"
            label="Indefinitely"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(5)}>
          <Adw.ButtonContent
            iconName="appointment-soon-symbolic"
            label="5 minutes"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(15)}>
          <Adw.ButtonContent
            iconName="appointment-soon-symbolic"
            label="15 minutes"
          />
        </Gtk.Button>
        <Gtk.Button onClicked={() => inhibit.setDuration(60)}>
          <Adw.ButtonContent
            iconName="appointment-soon-symbolic"
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
      </LinkedBox>
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
