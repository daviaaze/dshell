import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
import TimerService from "./TimerService"
import { TimerSection } from "./TimerSection"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"

function fmtShort(ms: number): string {
  if (ms < 0) return "Timer"
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export const QuickTimerButton = () => {
  const timer = TimerService.get_default()
  const remaining = createBinding(timer, "remaining")
  const running = createBinding(timer, "running")

  const label = createComputed([remaining], (rem) =>
    rem >= 0 ? fmtShort(rem) : "Timer",
  )

  const icon = createComputed([running], () =>
    "emoji-recent-symbolic",
  )

  const cssClasses = createComputed([running], (r) =>
    r ? ["raised", "suggested-action"] : ["raised"],
  )

  const popover = (
    <Gtk.Popover cssClasses={[]}>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        cssClasses={["popover-padded"]}
        widthRequest={220}
        halign={Gtk.Align.FILL}
      >
        <TimerSection />
      </Gtk.Box>
    </Gtk.Popover>
  ) as Gtk.Popover

  return (
    <QuickToggleButton
      cssClasses={cssClasses}
      icon={icon}
      label={label}
      popover={popover}
      onClick={() => {
        if (timer.remaining >= 0) timer.cancel()
      }}
    />
  )
}
