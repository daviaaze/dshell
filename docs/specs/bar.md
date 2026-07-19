# Spec: Bar

> Contract for the shell bar. Functional tests verify the **Functional**
> section; the theme linter + visual checklist verify the **Visual** section.

## Overview

- **Source**: `src/widget/bar/` (entry: `index.tsx`)
- **Settings group**: `barSchema` (`src/lib/settings/schema.ts`) —
  `position`, `showLauncher`, `showWorkspaces`, `showWindowTitle`,
  `showSystemResources`, `showClock`, `showWeather`, `showSystemIndicators`,
  `showBluetoothBattery`
- **Layer/behavior**: one `Astal.Window` per monitor, `EXCLUSIVE`
  exclusivity, anchored to the configured edge; registered in
  `WindowManager` as the bar (affects maximized-window gaps)

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Position change | `bar.position` set to TOP/BOTTOM/LEFT/RIGHT | Window re-anchors to that edge; orientation becomes vertical for LEFT/RIGHT, horizontal otherwise; 4px outer margin on the non-anchored side |
| F2 | Module toggles | Each `show*` setting flipped | The corresponding module (launcher, workspaces, window title, system usage, clock, weather, system indicators) appears/disappears without restart |
| F3 | Separator logic | Adjacent modules toggled | Separators only render when both neighboring modules are visible (clock/weather, weather/indicators, launcher/usage) |
| F4 | Multi-monitor | Monitor hotplug | One bar per monitor via `For each={monitors}`; bars destroyed and unregistered from `WindowManager` on monitor removal |
| F5 | Workspaces | Hyprland workspace/client events | Only workspaces of the bar's own monitor shown, sorted by id; `Adw.ToggleGroup` marks the focused client's toggle active; special workspaces (id < 0) get `success` style class |
| F6 | Recording | Screen/audio capture active | Recording indicator appears in end section |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click launcher | Toggles app launcher (button `active` bound to `ShellState.launcherOpen`) |
| I2 | Click system indicators | Toggles QuickSettings (button `active` bound to `ShellState.qsOpen`) |
| I3 | Scroll over system indicators | Default speaker volume ±2.5% per step |
| I4 | Click clock | Opens calendar/timer popover (`Gtk.MenuButton`, arrow direction follows bar orientation) |
| I5 | Click weather | Opens weather detail popover |
| I6 | Click workspace client icon | Focuses that specific client; empty workspaces show a placeholder toggle |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | No focused window | WindowTitle hides or shows fallback; no layout jump |
| E2 | Weather unavailable/offline | WeatherButton shows fallback icon, no error badge |
| E3 | Battery absent (desktop) | Battery indicator hidden, no empty slot |
| E4 | Vertical bar | Clock rotates/stacks legibly; indicators stack vertically |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Bar window | `card` + `background` Adw classes | No custom background CSS |
| Module groups (start/end) | `linked` | Segmented Adwaita look |
| Center box | `bar-centerbox` + `useStyle` (0 min-height, `0 4px` padding) | Spacing only, no colors |
| Workspaces | `Adw.ToggleGroup` / `Adw.Toggle` (Adw defaults); `success` class for special workspaces | Active state comes from Adw accent, not custom CSS |
| Indicator icons | symbolic, `--shade-fg`; warning states `--shade-error` | e.g. low battery, recording |
| Separators | `--shade-outline-variant` | |
| Clock/labels | `--shade-fg`; secondary text `--shade-fg-dim` or `dim-label` | |

### Adwaita checklist

- [ ] Only Adw classes / `useStyle` layout props — no hardcoded colors
- [ ] Spacing on the 6px grid (bar padding 4px is the documented exception)
- [ ] Radius via `--shade-radius` for any pill/card children
- [ ] Verified in light and dark variants (both bar positions)
- [ ] All icons symbolic; indicator buttons have visible hover/focus using `--shade-primary`

## Test plan

- **Unit**: extract and test `systemUsage` formatting (CPU/RAM/temp strings),
  workspace filtering per monitor (`Gdk2HyprMonitor`), and separator
  visibility logic from settings values.
- **Compliance linter**: no exceptions expected — bar should be fully token-driven.
- **Visual/manual**: screenshots in light + dark, horizontal + vertical,
  with each `show*` toggle combination of the end section; attach baselines
  to `assets/`.
