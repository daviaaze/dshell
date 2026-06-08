# QuickTimer — Design Spec

> **Date:** 2026-06-08
> **Status:** Design approved

## Overview

A quick-access timer for shade-shell with two modes:
- **Pomodoro** — auto-cycling work/break intervals with session tracking
- **Countdown** — set-and-forget timer with configurable quick presets

Integrated into the bar clock popover and the quicksettings button grid. One timer at a time, in-memory only, notification + sound on completion.

---

## Architecture

```
TimerService (GObject singleton)
  ├── Reactive properties (remaining, total, running, mode, label)
  ├── Pomodoro sub-state (workDuration, breakDuration, session, isBreak)
  ├── 1-second tick via GLib.timeout_add
  └── Notifd integration for alerts

Clock (src/widget/bar/clock.tsx)  ← reads TimerService.remaining for overlay
ClockPopover                         ← new TimerSection component appended
QS Button Grid                       ← new QuickTimerButton with popover
```

### TimerService — `src/widget/quicksettings/timer/TimerService.ts`

A GObject singleton (`TimerService.get_default()`) with:

| Property | Type | Kebab Notify | Description |
|----------|------|-------------|-------------|
| `remaining` | Number (ms) | `remaining` | Milliseconds remaining (-1 when no timer) |
| `total` | Number (ms) | `total` | Total duration in ms |
| `running` | Boolean | `running` | Whether timer is actively counting |
| `mode` | String | `mode` | `"none"` \| `"countdown"` \| `"pomodoro"` |
| `label` | String | `label` | Human-readable label (e.g., "Work 25:00 — Session 3") |
| `pomodoroSession` | Number | `pomodoro-session` | Current pomodoro cycle number |
| `pomodoroIsBreak` | Boolean | `pomodoro-is-break` | Whether current pomodoro segment is break |

**Methods:**
- `startCountdown(ms: number, label?: string)` — start a countdown
- `startPomodoro()` — start pomodoro cycle (first work segment)
- `pause()` / `resume()` — toggle running state
- `cancel()` — stop timer, reset to idle (`remaining = -1`, `mode = "none"`)
- `tick()` — decrement remaining by 1s; if zero → alert + auto-cycle (pomodoro) or cancel (countdown)

**Pomodoro auto-cycle logic:**
1. Work segment ends → notify "Work complete! Break time." → auto-start break segment
2. Break segment ends → notify "Break over. Back to work!" → auto-start next work segment
3. After `longBreakInterval` sessions → long break instead of short break
4. Auto-cycle only if `mode === "pomodoro"` and timer reached zero naturally (not user cancel)

---

## UI Components

### 1. Bar Clock Overlay — modify `src/widget/bar/clock.tsx`

When `TimerService.remaining >= 0` (timer active), the clock display switches from current time to remaining time formatted as `MM:SS` (or `HH:MM:SS` for >1h). Visual cue: add a `timer-active` CSS class for distinct styling (e.g., accent color). Clicking still opens the clock popover.

### 2. TimerSection — `src/widget/quicksettings/timer/TimerSection.tsx`

The main timer UI, shared between clock popover and QS button popover. Two states:

**Idle state:**
- Mode tabs/toggle: "Countdown" | "Pomodoro"
- Countdown: preset pills (1m, 5m, 10m, 15m, 30m, 1h) + custom hh:mm:ss entry via spinbuttons
- Pomodoro: work/break duration display, "Start Pomodoro" button

**Running state:**
- Large countdown display (`MM:SS` or `HH:MM:SS`)
- Mode label (e.g., "Work — Session 3" for pomodoro, custom label for countdown)
- Progress bar (fraction = `1 - remaining/total`)
- Pause/Resume button (toggles `running`)
- Cancel button (calls `TimerService.cancel()`)

**Pomodoro-specific:**
- Shows current segment type (Work/Break) and session number
- After completion, auto-transitions — no user action needed

### 3. QuickTimerButton — `src/widget/quicksettings/timer/QuickTimerButton.tsx`

A button in the quicksettings button grid (alongside WiFi, Bluetooth, etc.):
- **Icon:** `hourglass-symbolic` (or `alarm-symbolic` when running)
- **Label:** "Timer" when idle, remaining time (`MM:SS`) when running
- **Popover:** Contains `<TimerSection />`
- Uses the existing `QuickToggleButton` pattern with `usePopoverCleanup`

### 4. Integration points

**Clock Popover** (`src/widget/bar/clock.tsx`):
- Add `<TimerSection />` below the World Clock list inside the existing `Gtk.Popover`

**QS Button Grid** (`src/widget/quicksettings/button-grid/index.tsx`):
- Add `<QuickTimerButton />` to the button list (no conditions — always visible)

---

## GSettings Schema

New schema `org.shade-shell.timer` added to `src/lib/gschema.ts`:

```xml
<schema id="org.shade-shell.timer" path="/org/shade-shell/timer/">
  <key name="pomodoro-work-duration" type="i"><default>25</default></key>
  <key name="pomodoro-break-duration" type="i"><default>5</default></key>
  <key name="pomodoro-long-break-duration" type="i"><default>15</default></key>
  <key name="pomodoro-sessions-before-long-break" type="i"><default>4</default></key>
  <key name="countdown-presets" type="ai"><default>[1, 5, 10, 15, 30, 60]</default></key>
  <key name="timer-alert-sound" type="s"><default>"complete"</default></key>
</schema>
```

Durations in minutes (integers). Presets as an array of minutes.

Settings exposed via `createSettings` in the reactive settings context (`src/lib/settings.ts`).

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/widget/quicksettings/timer/TimerService.ts` | GObject singleton, timer engine |
| `src/widget/quicksettings/timer/TimerSection.tsx` | Shared timer UI component |
| `src/widget/quicksettings/timer/QuickTimerButton.tsx` | QS button with popover |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/gschema.ts` | Add `timer` schema definition |
| `src/lib/settings.ts` | Add timer settings to context |
| `src/widget/bar/clock.tsx` | Add timer overlay to clock display + TimerSection to popover |
| `src/widget/quicksettings/button-grid/index.tsx` | Add QuickTimerButton to grid |
| `src/widget/index.tsx` | Initialize TimerService (if needed) |
| `src/shade.css` | Add `.timer-active` and timer-related CSS classes |

---

## Reactive Data Flow

```
TimerService (singleton, GObject)
  ├── notify("remaining") ──→ Clock overlay (createBinding)
  ├── notify("running")  ──→ QuickTimerButton label/icon (createBinding)
  ├── notify("mode")     ──→ TimerSection mode display (createBinding)
  └── notify("label")    ──→ TimerSection label display (createBinding)
```

All components share the same `TimerService.get_default()` singleton. No prop drilling needed — each component binds directly to the GObject properties via `createBinding`.

---

## Edge Cases & Error Handling

- **Timer tick during suspend:** `GLib.timeout_add` pauses when the system suspends; remaining time will be behind by the suspend duration. Acceptable for v1.
- **Invalid custom input:** Spinbuttons constrained to valid ranges (0–99h, 0–59m, 0–59s). Start button disabled when total is 0.
- **TimerService not initialized:** Components using `createBinding` will see default values (`remaining = -1`, `running = false`). UI handles idle state gracefully.
- **Notifd unavailable:** Alert falls back to a simple `print()` and the timer still completes. No crash.
- **Multiple rapid clicks:** `startCountdown`/`startPomodoro` cancels any existing timer first (enforces "one at a time").

---

## What's Out of Scope

- Stopwatch mode
- Alarm (specific time-of-day) mode
- Persistence across restarts
- Multiple concurrent timers
- Audio file selection (sound is a predefined system sound)
- Lap/split tracking
