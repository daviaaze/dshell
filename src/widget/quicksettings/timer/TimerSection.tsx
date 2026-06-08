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

const PRESETS = [1, 5, 10, 15, 30, 60]

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

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      marginTop={4}
      marginBottom={4}
      marginStart={4}
      marginEnd={4}
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
        <Gtk.ProgressBar fraction={fraction} cssClasses={["osd"]} />
        <Gtk.Box spacing={4} halign={Gtk.Align.CENTER}>
          <Gtk.Button
            cssClasses={["circular", "flat"]}
            iconName={running.as((r) =>
              r ? "media-playback-pause-symbolic" : "media-playback-start-symbolic",
            )}
            onClicked={() => {
              if (timer.running) timer.pause()
              else timer.resume()
            }}
          />
          <Gtk.Button
            cssClasses={["circular", "flat"]}
            iconName={"media-playback-stop-symbolic"}
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

        {/* Countdown presets */}
        <Gtk.Box
          visible={selectedMode.as((m) => m === "countdown")}
          cssClasses={["linked"]}
          halign={Gtk.Align.CENTER}
        >
          {PRESETS.map((min) => (
            <Gtk.Button
              cssClasses={["flat"]}
              onClicked={() => timer.startCountdown(min * 60 * 1000)}
            >
              <Gtk.Label
                label={min >= 60 ? `${min / 60}h` : `${min}m`}
              />
            </Gtk.Button>
          ))}
        </Gtk.Box>

        {/* Custom countdown */}
        <Gtk.Box
          visible={selectedMode.as((m) => m === "countdown")}
          spacing={4}
          halign={Gtk.Align.CENTER}
        >
          <Gtk.SpinButton
            adjustment={Gtk.Adjustment.new(0, 0, 99, 1, 10, 0)}
            digits={0}
            valign={Gtk.Align.CENTER}
            cssClasses={[]}
          />
          <Gtk.Label label="h" valign={Gtk.Align.CENTER} />
          <Gtk.SpinButton
            adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
            digits={0}
            valign={Gtk.Align.CENTER}
            cssClasses={[]}
          />
          <Gtk.Label label="m" valign={Gtk.Align.CENTER} />
          <Gtk.SpinButton
            adjustment={Gtk.Adjustment.new(0, 0, 59, 1, 10, 0)}
            digits={0}
            valign={Gtk.Align.CENTER}
            cssClasses={[]}
          />
          <Gtk.Label label="s" valign={Gtk.Align.CENTER} />
          <Gtk.Button
            cssClasses={["flat"]}
            onClicked={(self) => {
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
            }}
          >
            <Gtk.Label label="Go" />
          </Gtk.Button>
        </Gtk.Box>

        {/* Pomodoro start */}
        <Gtk.Button
          visible={selectedMode.as((m) => m === "pomodoro")}
          cssClasses={["raised", "suggested-action"]}
          halign={Gtk.Align.FILL}
          hexpand
          onClicked={() => timer.startPomodoro()}
          label="Start Pomodoro"
        />
      </Gtk.Box>
    </Gtk.Box>
  )
}
