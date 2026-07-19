# Spec: QuickSettings

> System control panel with toggles, sliders, trays, and notification list.

## Overview

- **Source**: `src/widget/quicksettings/` (entry: `index.tsx`, subdirs: `button-grid/`, `expander/`, `network/`, `timer/`)
- **Settings group**: `barSchema` for position; various per-module settings
- **Dependencies**: `ShellState`, `Astal`, `AstalWp`, `AstalHyprland`, `WindowManager`
- **Type**: `Astal.Window`, width-request 420px, anchored to the bar's edge; visible when `ShellState.qsOpen`

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Closed | Default | Window hidden; `ShellState.qsOpen` = false |
| F2 | Open | Click system indicators in bar (or shortcut) | Window visible; QS open state set; if bar on LEFT/RIGHT and launcher open, launcher closes |
| F3 | Side bar position | Bar position on LEFT or RIGHT | QS anchors to same edge; launcher auto-closed |
| F4 | Scrolled content | More modules than visible height | `ScrolledWindow` with auto vertical scrollbar; natural height propagated |

### Sub-modules

| Module | Source | Behavior |
|--------|--------|----------|
| Button grid | `button-grid/` | Toggle buttons for common actions (bluetooth, WiFi, DND, recording, screenshot, etc.) |
| Brightness slider | `sliders.tsx` | Gtk.LevelBar bound to `Brightness.screen` |
| Audio config | `sliders.tsx` | Speaker/mic volume sliders bound to Wireplumber |
| Tray | `tray.tsx` | System tray widget showing running service icons |
| Expander | `expander/` | Collapsible sections: media player, world clock |
| Notification list | `notificationList.tsx` | Recent notifications (compact) |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Click a button-grid toggle | Toggles corresponding system state (DND, recording, etc.) |
| I2 | Adjust brightness slider | Updates `Brightness.screen` reactively |
| I3 | Adjust audio slider | Updates Wireplumber speaker/mic volume |
| I4 | Click tray icon | Opens that service's context menu |
| I5 | Click notification in list | Expands/handles the notification |
| I6 | Click outside QS | QS closes |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `card` + `frame` + `background` | Adw classes |
| Content padding | `popover-padded-lg` | Shared Adw padding class |
| Sliders | `Gtk.LevelBar` | Standard GTK level bars |
| Tray buttons | `flat` + `circular` | Adw classes |
| Spacing | `QUICKSETTINGS_SPACING = 8` | Subtle 8px gap |

### Adwaita checklist

- [x] Uses `card` `frame` `background` on window
- [x] Uses `popover-padded-lg` for content padding
- [x] Icons are symbolic
- [x] Scrollable with max-height
- [x] Verified in light and dark

## Test plan

- **Unit**: test `ShellState.qsOpen` + `launcherOpen` mutual exclusion logic, slider value clamping
- **Compliance linter**: file-size warning on `note` subfiles? Check individually; get_default in JSX
- **Visual/manual**: screenshots of each module group; test scroll overflow
