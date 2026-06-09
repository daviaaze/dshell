# QuickTimer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pomodoro + countdown timer to the bar clock popover and quicksettings button grid, with clock overlay showing remaining time.

**Architecture:** A `TimerService` GObject singleton drives all timer state. `TimerSection` is a shared UI component placed in both the clock popover and a new QS button's popover. The bar clock reads `TimerService.remaining` to overlay the countdown. All reactive via `createBinding` on kebab-case notified GObject properties.

**Tech Stack:** GJS (SpiderMonkey), Gnim (reactive JSX), GTK 4, Libadwaita, GObject, Gio.Notification, GSettings (gnim-schemas)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/widget/quicksettings/timer/TimerService.ts` | GObject singleton: timer state, tick loop, pomodoro auto-cycle, alerts via Gio.Notification |
| Create | `src/widget/quicksettings/timer/TimerSection.tsx` | Shared timer UI: presets, countdown display, pomodoro controls, progress bar |
| Create | `src/widget/quicksettings/timer/QuickTimerButton.tsx` | QS button grid entry: wraps QuickToggleButton with TimerSection popover |
| Modify | `src/lib/gschema.ts` | Add `timer` GSettings schema (6 keys) |
| Modify | `src/lib/settings.ts` | Add timer settings to context |
| Modify | `src/widget/bar/clock.tsx` | Bind TimerService.remaining → overlay on clock; add TimerSection to popover |
| Modify | `src/widget/quicksettings/button-grid/index.tsx` | Add QuickTimerButton to grid items |
| Modify | `src/widget/index.tsx` | Initialize TimerService with settings + app |
| Modify | `src/shade.css` | Add `.timer-active`, `.timer-display`, `.timer-label` CSS classes |

---

### Task 1: Create TimerService GObject singleton

**Files:**
- Create: `src/widget/quicksettings/timer/TimerService.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/widget/quicksettings/timer
```

- [ ] **Step 2: Write TimerService.ts**

```ts
import Adw from "gi://Adw"
import Gio from "gi://Gio"
import GLib from "gi://GLib?version=2.0"
import GObject, { getter, register } from "gnim/gobject"
import logger from "#/lib/logger"

export type TimerMode = "none" | "countdown" | "pomodoro"

@register({ GTypeName: "TimerService" })
export default class TimerService extends GObject.Object {
  static instance: TimerService
  static get_default() {
    if (!this.instance) this.instance = new TimerService()
    return this.instance
  }

  // ── GObject properties ──
  #remaining = -1
  #total = 0
  #running = false
  #mode: TimerMode = "none"
  #label = ""
  #pomodoroSession = 0
  #pomodoroIsBreak = false

  // ── Internal ──
  #tickId: number | null = null
  #app: Adw.Application | null = null
  #initialized = false
  #notificationId = 0

  // ── Pomodoro settings ──
  #workDuration = 25 * 60 * 1000
  #breakDuration = 5 * 60 * 1000
  #longBreakDuration = 15 * 60 * 1000
  #sessionsBeforeLongBreak = 4

  @getter(Number)
  get remaining() { return this.#remaining }

  @getter(Number)
  get total() { return this.#total }

  @getter(Boolean)
  get running() { return this.#running }

  @getter(String)
  get mode() { return this.#mode }

  @getter(String)
  get label() { return this.#label }

  @getter(Number)
  get pomodoroSession() { return this.#pomodoroSession }

  @getter(Boolean)
  get pomodoroIsBreak() { return this.#pomodoroIsBreak }

  // ── Public API ──

  startCountdown(ms: number, customLabel?: string) {
    this.#cancelTimer()
    this.#remaining = ms
    this.#total = ms
    this.#mode = "countdown"
    this.#label = customLabel || this.#fmtDuration(ms)
    this.#notifyAll()
    this.#startTick()
  }

  startPomodoro() {
    this.#cancelTimer()
    this.#pomodoroSession = 1
    this.#pomodoroIsBreak = false
    this.#remaining = this.#workDuration
    this.#total = this.#workDuration
    this.#mode = "pomodoro"
    this.#label = `Work — Session 1`
    this.#notifyAll()
    this.#startTick()
  }

  pause() {
    if (!this.#running) return
    this.#stopTick()
    this.#running = false
    this.notify("running")
  }

  resume() {
    if (this.#running || this.#remaining <= 0) return
    this.#startTick()
  }

  cancel() {
    this.#cancelTimer()
    this.#remaining = -1
    this.#total = 0
    this.#mode = "none"
    this.#label = ""
    this.#pomodoroSession = 0
    this.#pomodoroIsBreak = false
    this.#notifyAll()
  }

  init(
    app: Adw.Application,
    workMin: number,
    breakMin: number,
    longBreakMin: number,
    sessionsBeforeLongBreak: number,
  ) {
    if (this.#initialized) return
    this.#initialized = true
    this.#app = app
    this.#workDuration = workMin * 60 * 1000
    this.#breakDuration = breakMin * 60 * 1000
    this.#longBreakDuration = longBreakMin * 60 * 1000
    this.#sessionsBeforeLongBreak = sessionsBeforeLongBreak
  }

  // ── Internal ──

  #startTick() {
    this.#stopTick()
    this.#running = true
    this.notify("running")
    this.#tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      this.#remaining -= 1000
      if (this.#remaining <= 0) {
        this.#remaining = 0
        this.notify("remaining")
        this.#stopTick()
        this.#running = false
        this.notify("running")
        this.#onComplete()
        return GLib.SOURCE_REMOVE
      }
      this.notify("remaining")
      return GLib.SOURCE_CONTINUE
    })
  }

  #stopTick() {
    if (this.#tickId) {
      GLib.source_remove(this.#tickId)
      this.#tickId = null
    }
  }

  #cancelTimer() {
    this.#stopTick()
    this.#running = false
  }

  #onComplete() {
    const isPomodoro = this.#mode === "pomodoro"
    const title = isPomodoro
      ? (this.#pomodoroIsBreak ? "Break over! Back to work." : "Work session complete!")
      : "Timer finished!"
    const body = isPomodoro
      ? `Session ${this.#pomodoroSession} complete.`
      : this.#label

    this.#sendNotification(title, body)

    if (isPomodoro) {
      if (this.#pomodoroIsBreak) {
        // Break over → next work segment
        this.#pomodoroSession++
        this.#pomodoroIsBreak = false
        this.#remaining = this.#workDuration
        this.#total = this.#workDuration
        this.#label = `Work — Session ${this.#pomodoroSession}`
      } else {
        // Work done → break
        this.#pomodoroIsBreak = true
        const isLong = this.#pomodoroSession % this.#sessionsBeforeLongBreak === 0
        this.#remaining = isLong ? this.#longBreakDuration : this.#breakDuration
        this.#total = this.#remaining
        this.#label = isLong ? "Long Break" : "Break"
      }
      this.#notifyAll()
      this.#startTick()
    } else {
      this.#mode = "none"
      this.notify("mode")
    }
  }

  #sendNotification(title: string, body: string) {
    if (!this.#app) {
      print(`[Timer] ${title} — ${body}`)
      return
    }
    try {
      const n = new Gio.Notification()
      n.set_title(title)
      n.set_body(body)
      n.set_icon(Gio.Icon.new_for_string("alarm-symbolic"))
      this.#notificationId++
      const id = `timer-${this.#notificationId}`
      this.#app.send_notification(id, n)
    } catch (e) {
      logger.warn("timer", "Failed to send notification:", e)
      print(`[Timer] ${title} — ${body}`)
    }
  }

  #fmtDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  #notifyAll() {
    this.notify("remaining")
    this.notify("total")
    this.notify("running")
    this.notify("mode")
    this.notify("label")
    this.notify("pomodoro-session")
    this.notify("pomodoro-is-break")
  }
}
```

- [ ] **Step 3: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/widget/quicksettings/timer/TimerService.ts
git commit -m "feat(timer): add TimerService GObject singleton"
```

---

### Task 2: Add GSettings timer schema

**Files:**
- Modify: `src/lib/gschema.ts`

- [ ] **Step 1: Add timerSchema and include in list**

Insert after the `weatherSchema` definition (before `export const generalSchema`):

```ts
export const timerSchema = new Schema({
  id: id + ".timer",
  path: path + "timer/",
})
  .key("pomodoro-work-duration", "i", {
    default: 25,
    summary: "Pomodoro work duration in minutes",
  })
  .key("pomodoro-break-duration", "i", {
    default: 5,
    summary: "Pomodoro short break duration in minutes",
  })
  .key("pomodoro-long-break-duration", "i", {
    default: 15,
    summary: "Pomodoro long break duration in minutes",
  })
  .key("pomodoro-sessions-before-long-break", "i", {
    default: 4,
    summary: "Number of work sessions before a long break",
  })
  .key("countdown-presets", "ai", {
    default: [1, 5, 10, 15, 30, 60],
    summary: "Countdown preset durations in minutes",
  })
  .key("timer-alert-sound", "s", {
    default: "complete",
    summary: "Sound name for timer alerts (freedesktop sound theme)",
  })
```

Update `defineSchemaList` at the bottom:

```ts
export default defineSchemaList([barSchema, generalSchema, weatherSchema, timerSchema])
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/gschema.ts
git commit -m "feat(timer): add timer GSettings schema"
```

---

### Task 3: Add timer settings to context

**Files:**
- Modify: `src/lib/settings.ts`

- [ ] **Step 1: Import and add timer to createAppSettings**

Change import line 4:
```ts
import { barSchema, generalSchema, weatherSchema, timerSchema } from "./gschema"
```

Inside `createAppSettings()`, add `timerSettings` and the `timer` property:

```ts
function createAppSettings() {
  const barSettings = new Gio.Settings({ schemaId: barSchema.id })
  const weatherSettings = new Gio.Settings({ schemaId: weatherSchema.id })
  const generalSettings = new Gio.Settings({ schemaId: generalSchema.id })
  const timerSettings = new Gio.Settings({ schemaId: timerSchema.id })
  return {
    bar: {
      barSettings,
      ...createSettings(barSettings, barSchema),
    },
    general: {
      generalSettings,
      ...createSettings(generalSettings, generalSchema),
    },
    weather: {
      weatherSettings,
      ...createSettings(weatherSettings, weatherSchema),
    },
    timer: {
      timerSettings,
      ...createSettings(timerSettings, timerSchema),
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat(timer): add timer settings to context"
```

---

### Task 4: Initialize TimerService in widgets()

**Files:**
- Modify: `src/widget/index.tsx`

- [ ] **Step 1: Import TimerService and init it**

Add import (after line 13, near other service imports):
```ts
import TimerService from "./quicksettings/timer/TimerService"
```

In `widgets()`, add after line 42 (`Inhibit.get_default().init(app)`):
```ts
TimerService.get_default().init(
  app,
  s.timer.pomodoroWorkDuration.get(),
  s.timer.pomodoroBreakDuration.get(),
  s.timer.pomodoroLongBreakDuration.get(),
  s.timer.pomodoroSessionsBeforeLongBreak.get(),
)
```

- [ ] **Step 2: Commit**

```bash
git add src/widget/index.tsx
git commit -m "feat(timer): initialize TimerService in widgets"
```

---

### Task 5: Create TimerSection shared component

**Files:**
- Create: `src/widget/quicksettings/timer/TimerSection.tsx`

- [ ] **Step 1: Write TimerSection.tsx**

```ts
import Gtk from "gi://Gtk?version=4.0"
import { createBinding, createComputed } from "gnim"
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

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      marginTop={4}
      marginBottom={4}
      marginStart={4}
      marginEnd={4}
    >
      {/* ── Running state ── */}
      <Gtk.Box
        visible={isActive}
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
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
      >
        {/* Mode toggle */}
        <Gtk.Box cssClasses={["linked"]} halign={Gtk.Align.CENTER}>
          <Gtk.ToggleButton
            active={mode.as((m) => m === "pomodoro")}
            cssClasses={[]}
            onClicked={() => {}}
          >
            <Gtk.Label label="Pomodoro" />
          </Gtk.ToggleButton>
          <Gtk.ToggleButton
            active={mode.as((m) => m === "countdown" || m === "none")}
            cssClasses={[]}
            onClicked={() => {}}
          >
            <Gtk.Label label="Countdown" />
          </Gtk.ToggleButton>
        </Gtk.Box>

        {/* Countdown presets */}
        <Gtk.Box
          visible={mode.as((m) => m !== "pomodoro")}
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
          visible={mode.as((m) => m !== "pomodoro")}
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
          visible={mode.as((m) => m === "pomodoro")}
          cssClasses={["raised", "suggested-action"]}
          halign={Gtk.Align.CENTER}
          onClicked={() => timer.startPomodoro()}
          label="Start Pomodoro"
        />
      </Gtk.Box>
    </Gtk.Box>
  )
}
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/widget/quicksettings/timer/TimerSection.tsx
git commit -m "feat(timer): add TimerSection shared component"
```

---

### Task 6: Create QuickTimerButton for QS grid

**Files:**
- Create: `src/widget/quicksettings/timer/QuickTimerButton.tsx`

- [ ] **Step 1: Write QuickTimerButton.tsx**

```ts
import Gtk from "gi://Gtk?version=4.0"
import Adw from "gi://Adw?version=1"
import { createBinding, createComputed } from "gnim"
import TimerService from "./TimerService"
import { TimerSection } from "./TimerSection"
import { QuickToggleButton } from "#/widget/common/quickToggleButton"
import { usePopoverCleanup } from "#/widget/common/popoverCleanup"

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

  const icon = createComputed([running], (r) =>
    r ? "alarm-symbolic" : "hourglass-symbolic",
  )

  const cssClasses = createComputed([running], (r) =>
    r ? ["raised", "suggested-action"] : ["raised"],
  )

  const popover = (
    <Gtk.Popover cssClasses={[]} $={usePopoverCleanup}>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        cssClasses={["popover-padded"]}
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
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/widget/quicksettings/timer/QuickTimerButton.tsx
git commit -m "feat(timer): add QuickTimerButton for QS grid"
```

---

### Task 7: Integrate into clock popover and add clock overlay

**Files:**
- Modify: `src/widget/bar/clock.tsx`

- [ ] **Step 1: Update gnim imports and add timer imports**

Change the gnim import line (line 4) from:
```ts
import { Accessor, createState, For, onCleanup } from "gnim"
```
to:
```ts
import { Accessor, createBinding, createComputed, createState, For, onCleanup } from "gnim"
```

Add timer imports after existing imports:
```ts
import TimerService from "#/widget/quicksettings/timer/TimerService"
import { TimerSection } from "#/widget/quicksettings/timer/TimerSection"
```

In the `export default` function, after `const localTz` line (~37), add:
```ts
const timer = TimerService.get_default()
const timerRemaining = createBinding(timer, "remaining")
const timerActive = createComputed([timerRemaining], (rem) => rem >= 0)
```

- [ ] **Step 2: Modify clock display for overlay**

Replace the clock display `Gtk.Box` (lines 110-135) to show remaining time when timer is active. The current clock display:

```tsx
<Gtk.Box ...>
  <Gtk.Box ...>
    <Gtk.Label label={hour} cssClasses={["title-1", "numeric"]} />
    <Gtk.Label label={minute} cssClasses={["title-1", "numeric"]} />
  </Gtk.Box>
  <Gtk.Box ...>
    <Gtk.Label cssClasses={["caption-heading"]} label={day} />
    <Gtk.Label cssClasses={["caption"]} label={month} />
  </Gtk.Box>
</Gtk.Box>
```

Change the hour/minute labels to conditionally show timer:

```tsx
<Gtk.Box
  halign={Gtk.Align.CENTER}
  valign={Gtk.Align.CENTER}
  orientation={vertical.as((v) =>
    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
  )}
  spacing={vertical.as((v) => (v ? 0 : 4))}
>
  <Gtk.Box
    orientation={vertical.as((v) =>
      v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
    )}
    spacing={vertical.as((v) => (v ? 0 : 4))}
  >
    <Gtk.Label
      label={timerActive.as((a) =>
        a
          ? timerRemaining.as((rem) => {
              const totalSec = Math.max(0, Math.ceil(rem / 1000))
              const m = Math.floor(totalSec / 60)
              const s = totalSec % 60
              return `${m.toString().padStart(2, "0")}`
            })
          : hour,
      )}
      cssClasses={timerActive.as((a) =>
        a ? ["title-1", "numeric", "timer-active"] : ["title-1", "numeric"],
      )}
    />
    <Gtk.Label
      label={timerActive.as((a) =>
        a
          ? timerRemaining.as((rem) => {
              const totalSec = Math.max(0, Math.ceil(rem / 1000))
              const s = totalSec % 60
              return `${s.toString().padStart(2, "0")}`
            })
          : minute,
      )}
      cssClasses={timerActive.as((a) =>
        a ? ["title-1", "numeric", "timer-active"] : ["title-1", "numeric"],
      )}
    />
  </Gtk.Box>
  <Gtk.Box
    visible={timerActive.as((a) => !a)}
    orientation={Gtk.Orientation.VERTICAL}
    halign={Gtk.Align.CENTER}
    valign={Gtk.Align.CENTER}
  >
    <Gtk.Label cssClasses={["caption-heading"]} label={day} />
    <Gtk.Label cssClasses={["caption"]} label={month} />
  </Gtk.Box>
</Gtk.Box>
```

Wait — this is getting complex with nested `.as()` calls. Gnim's `.as()` returns an `Accessor<boolean | string>` which won't work cleanly with nested `.as()`. Let me simplify using `createComputed` instead.

Let me rewrite the clock overlay approach to be cleaner:

```tsx
const displayMinute = createComputed([timerActive, timerRemaining, minute, hour], (active, rem, min, hr) => {
  if (!active) return min
  const totalSec = Math.max(0, Math.ceil(rem / 1000))
  const m = Math.floor(totalSec / 60)
  return m.toString().padStart(2, "0")
})

const displaySecond = createComputed([timerActive, timerRemaining], (active, rem) => {
  if (!active) return ""
  const totalSec = Math.max(0, Math.ceil(rem / 1000))
  const s = totalSec % 60
  return s.toString().padStart(2, "0")
})
```

And adjust the display. Actually this is getting too complex for a plan step. Let me think of the simplest approach.

The simplest: when timer is active, replace the hour:minute with remaining time (MM:SS). When timer is inactive, show normal clock. Use two sets of labels with `visible` bindings.

```tsx
const timerDisplay = createComputed([timerRemaining], (rem) => {
  if (rem < 0) return ""
  const totalSec = Math.max(0, Math.ceil(rem / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
})
```

Replace the hour/minute box with:

```tsx
<Gtk.Box ...>
  {/* Normal clock */}
  <Gtk.Box
    visible={timerActive.as((a) => !a)}
    orientation={vertical.as(...)}
    spacing={vertical.as(...)}
  >
    <Gtk.Label label={hour} cssClasses={["title-1", "numeric"]} />
    <Gtk.Label label={minute} cssClasses={["title-1", "numeric"]} />
  </Gtk.Box>
  {/* Timer overlay */}
  <Gtk.Label
    visible={timerActive}
    label={timerDisplay}
    cssClasses={["title-1", "numeric", "timer-active"]}
  />
</Gtk.Box>
```

This is much simpler! Two mutually exclusive labels. Let me use this approach in the plan.

- [ ] **Step 1 Rewrite: Modify clock display**

Add after line 37 (`let calendarRef: Gtk.Calendar | null = null`):

```ts
const timer = TimerService.get_default()
const timerRemaining = createBinding(timer, "remaining")
const timerActive = createComputed([timerRemaining], (rem) => rem >= 0)
const timerDisplay = createComputed([timerRemaining], (rem) => {
  if (rem < 0) return ""
  const totalSec = Math.max(0, Math.ceil(rem / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
})
```

Replace the inner clock box content (lines 110-135), keeping the outer `Gtk.Box` with halign/valign/orientation/spacing. Replace the children with:

```tsx
<Gtk.Box
  orientation={vertical.as((v) =>
    v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
  )}
  spacing={vertical.as((v) => (v ? 0 : 4))}
>
  {/* Normal clock */}
  <Gtk.Box
    visible={timerActive.as((a) => !a)}
    orientation={vertical.as((v) =>
      v ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
    )}
    spacing={vertical.as((v) => (v ? 0 : 4))}
  >
    <Gtk.Label label={hour} cssClasses={["title-1", "numeric"]} />
    <Gtk.Label label={minute} cssClasses={["title-1", "numeric"]} />
  </Gtk.Box>
  {/* Timer overlay */}
  <Gtk.Label
    visible={timerActive}
    label={timerDisplay}
    cssClasses={["title-1", "numeric", "timer-active"]}
  />
</Gtk.Box>
<Gtk.Box
  visible={timerActive.as((a) => !a)}
  orientation={Gtk.Orientation.VERTICAL}
  halign={Gtk.Align.CENTER}
  valign={Gtk.Align.CENTER}
>
  <Gtk.Label cssClasses={["caption-heading"]} label={day} />
  <Gtk.Label cssClasses={["caption"]} label={month} />
</Gtk.Box>
```

- [ ] **Step 2: Add TimerSection to clock popover**

Inside the popover's `Gtk.Box` (spacing=12, orientation=VERTICAL), after the World Clock `Gtk.Box` (lines 72-103), add a separator and the TimerSection:

```tsx
<Gtk.Separator />
<Gtk.Label
  cssClasses={["title-3"]}
  label="Timer"
  halign={Gtk.Align.CENTER}
/>
<TimerSection />
```

- [ ] **Step 3: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/widget/bar/clock.tsx
git commit -m "feat(timer): integrate timer overlay and TimerSection into clock"
```

---

### Task 8: Integrate QuickTimerButton into QS button grid

**Files:**
- Modify: `src/widget/quicksettings/button-grid/index.tsx`

- [ ] **Step 1: Add import and item**

Add import (after existing button imports):
```ts
import QuickTimerButton from "#/widget/quicksettings/timer/QuickTimerButton"
// or: import { QuickTimerButton } from "../timer/QuickTimerButton"
```

Wait, looking at the existing imports in button-grid/index.tsx, they use relative paths for same-directory buttons and absolute `#/` paths for others. QuickTimerButton is in a sibling directory. Let me use relative:
```ts
import { QuickTimerButton } from "../timer/QuickTimerButton"
```

Add `<QuickTimerButton />` to the `items` array. The timer button should always be visible, so add it without condition. Insert after `<Caffeinated />` (line 27):

```ts
<Caffeinated />,
<QuickTimerButton />,
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/widget/quicksettings/button-grid/index.tsx
git commit -m "feat(timer): add QuickTimerButton to QS grid"
```

---

### Task 9: Add timer CSS

**Files:**
- Modify: `src/shade.css`

- [ ] **Step 1: Add timer CSS classes**

Add at the end of `src/shade.css`:

```css
/* ═══════════════════════════════════════════════════════════════════════════
   TIMER
   ═══════════════════════════════════════════════════════════════════════════ */

.timer-active {
  color: var(--accent-color);
}

.timer-display {
  font-size: 2em;
  font-weight: 700;
}

.timer-label {
  opacity: 0.7;
  font-size: 0.9em;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shade.css
git commit -m "feat(timer): add timer CSS classes"
```

---

### Task 10: Final build verification

- [ ] **Step 1: Full build**

```bash
pnpm run build
```

- [ ] **Step 2: Check for any errors**

```bash
pnpm run build 2>&1 | grep -iE "error|fail" || echo "No errors"
```

- [ ] **Step 3: Review git log**

```bash
git log --oneline -10
```

---

## Spec Coverage Checklist

| Requirement | Task |
|-------------|------|
| TimerService GObject singleton | Task 1 |
| Pomodoro mode (auto-cycle, sessions, long break) | Task 1 |
| Countdown mode (presets + custom) | Task 1, 5 |
| One timer at a time | Task 1 (cancel before start) |
| In-memory only | Task 1 (no persistence) |
| Notification + sound on complete | Task 1 (Gio.Notification) |
| Clock overlay (remaining time on bar) | Task 7 |
| TimerSection in clock popover | Task 7 |
| QuickTimerButton in QS grid | Task 6, 8 |
| GSettings schema (6 keys) | Task 2 |
| Settings context | Task 3 |
| Service initialization | Task 4 |
| CSS styling | Task 9 |
