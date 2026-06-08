import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed, createState } from "gnim"
import TimerService from "./TimerService"

function fmtRemaining(ms: number): string {
  if (ms < 0) return "--:--"
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

const PRESETS = [
  [1, 5],
  [10, 15],
  [30, 60],
]

export const TimerSection = () => {
  const timer = TimerService.get_default()
  const remaining = createBinding(timer, "remaining")
  const total = createBinding(timer, "total")
  const running = createBinding(timer, "running")
  const mode = createBinding(timer, "mode")
  const label = createBinding(timer, "label")

  const isActive = createComputed([mode], (m) => m !== "none")
  const fraction = createComputed([remaining, total], (rem, tot) =>
    rem >= 0 && tot > 0 ? 1 - rem / tot : 0,
  )

  const [selectedMode, setSelectedMode] = createState<"countdown" | "pomodoro">("countdown")

  const startCustom = (self: Gtk.Button) => {
    const box = self.get_parent()
    if (!(box instanceof Gtk.Box)) return
    const spins: Gtk.SpinButton[] = []
    let child = box.get_first_child()
    while (child) {
      if (child instanceof Gtk.SpinButton) spins.push(child)
      child = child.get_next_sibling()
    }
    if (spins.length >= 3) {
      const h = spins[0]!.get_value_as_int()
      const m = spins[1]!.get_value_as_int()
      const s = spins[2]!.get_value_as_int()
      const ms = (h * 3600 + m * 60 + s) * 1000
      if (ms > 0) timer.startCountdown(ms)
    }
  }

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      halign={Gtk.Align.FILL}
    >
      {/* ── Running state ── */}
      <Gtk.Box
        visible={isActive}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        halign={Gtk.Align.FILL}
      >
        <Gtk.Label
          label={remaining.as((r) => fmtRemaining(r))}
          cssClasses={["timer-display", "numeric"]}
          halign={Gtk.Align.CENTER}
        />
        <Gtk.Label
          label={label}
          cssClasses={["timer-label"]}
          halign={Gtk.Align.CENTER}
          visible={label.as((l) => l.length > 0)}
        />
        <Gtk.ProgressBar fraction={fraction} cssClasses={["osd"]} hexpand />
        <Gtk.Box spacing={4} halign={Gtk.Align.FILL} hexpand>
          <Gtk.Button
            cssClasses={["flat"]}
            iconName={running.as((r) =>
              r ? "media-playback-pause-symbolic" : "media-playback-start-symbolic",
            )}
            label={running.as((r) => (r ? "Pause" : "Resume"))}
            hexpand
            onClicked={() => {
              if (timer.running) timer.pause()
              else timer.resume()
            }}
          />
          <Gtk.Button
            cssClasses={["flat"]}
            iconName={"media-playback-stop-symbolic"}
            label="Stop"
            hexpand
            onClicked={() => timer.cancel()}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* ── Idle state ── */}
      <Gtk.Box
        visible={isActive.as((a) => !a)}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        halign={Gtk.Align.FILL}
      >
        {/* Mode toggle tabs */}
        <Gtk.Box cssClasses={["linked"]} halign={Gtk.Align.CENTER}>
          <Gtk.ToggleButton
            active={selectedMode.as((m) => m === "pomodoro")}
            cssClasses={[]}
            onClicked={() => setSelectedMode("pomodoro")}
          >
            <Gtk.Label label="Pomodoro" />
          </Gtk.ToggleButton>
          <Gtk.ToggleButton
            active={selectedMode.as((m) => m === "countdown")}
            cssClasses={[]}
            onClicked={() => setSelectedMode("countdown")}
          >
            <Gtk.Label label="Countdown" />
          </Gtk.ToggleButton>
        </Gtk.Box>

        {/* Countdown view */}
        <Gtk.Box
          visible={selectedMode.as((m) => m === "countdown")}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={6}
          halign={Gtk.Align.FILL}
        >
          {/* Preset grid */}
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            halign={Gtk.Align.FILL}
          >
            {PRESETS.map((row, i) => (
              <Gtk.Box spacing={4} halign={Gtk.Align.FILL}>
                {row.map((min) => (
                  <Gtk.Button
                    cssClasses={["flat"]}
                    hexpand
                    onClicked={() => timer.startCountdown(min * 60 * 1000)}
                  >
                    <Gtk.Label
                      label={min >= 60 ? `${min / 60}h` : `${min}m`}
                    />
                  </Gtk.Button>
                ))}
              </Gtk.Box>
            ))}
          </Gtk.Box>

          {/* Custom entry */}
          <Gtk.Box spacing={2} halign={Gtk.Align.CENTER}>
            <Gtk.SpinButton
              adjustment={Gtk.Adjustment.new(0, 0, 99, 1, 10, 0)}
              digits={0}
              valign={Gtk.Align.CENTER}
              cssClasses={[]}
              widthRequest={48}
            />
            <Gtk.Label label="h" valign={Gtk.Align.CENTER} />
            <Gtk.SpinButton
              adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
              digits={0}
              valign={Gtk.Align.CENTER}
              cssClasses={[]}
              widthRequest={48}
            />
            <Gtk.Label label="m" valign={Gtk.Align.CENTER} />
            <Gtk.SpinButton
              adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
              digits={0}
              valign={Gtk.Align.CENTER}
              cssClasses={[]}
              widthRequest={48}
            />
            <Gtk.Label label="s" valign={Gtk.Align.CENTER} />
            <Gtk.Button
              cssClasses={["flat"]}
              onClicked={startCustom}
            >
              <Gtk.Label label="Go" />
            </Gtk.Button>
          </Gtk.Box>
        </Gtk.Box>

        {/* Pomodoro view */}
        <Gtk.Box
          visible={selectedMode.as((m) => m === "pomodoro")}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={8}
          halign={Gtk.Align.FILL}
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={2}
            halign={Gtk.Align.CENTER}
          >
            <Gtk.Label
              label="Work: 25 min · Break: 5 min"
              cssClasses={["caption"]}
            />
            <Gtk.Label
              label="Long break: 15 min (every 4)"
              cssClasses={["caption", "dim-label"]}
            />
          </Gtk.Box>
          <Gtk.Button
            cssClasses={["raised", "suggested-action"]}
            halign={Gtk.Align.FILL}
            hexpand
            onClicked={() => timer.startPomodoro()}
            label="Start Pomodoro"
          />
        </Gtk.Box>
      </Gtk.Box>
    </Gtk.Box>
  )
}
