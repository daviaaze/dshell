# Spec: QuickSettings

> System control panel with toggles, sliders, trays, and notification list.

## Overview

- **Source**: `packages/widgets/src/quicksettings/`
- **Settings group**: `barSchema` for position; various per-module settings
- **Dependencies**: `ShellState`, `Astal`, `AstalWp`, `AstalHyprland`, `WindowManager`
- **Type**: `Astal.Window`, width-request 420px, anchored to the bar's edge; visible when `ShellState.qsOpen`

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Closed | Default | Window hidden; `ShellState.qsOpen` = false |
| F2 | Open | Click system indicators in bar (or shortcut) | Window accepts native on-demand keyboard input without retaining an exclusive grab over other applications; QS open state set; side-bar opening closes the launcher |
| F3 | Side bar position | Bar position on LEFT or RIGHT | QS anchors to same edge; launcher auto-closed |
| F4 | Scrolled content | More modules than visible height | `ScrolledWindow` with auto vertical scrollbar; natural height propagated |

### Sub-modules

| Module | Source | Behavior |
|--------|--------|----------|
| Button grid | `button-grid/` | Native boolean toggles and command buttons with separate domain/value labels and linked option menus |
| Brightness slider | `sliders.tsx` | Gtk.LevelBar bound to `Brightness.screen` |
| Audio config | `sliders.tsx` | Speaker/mic volume sliders bound to Wireplumber |
| Tray | `tray.tsx` | System tray widget showing running service icons |
| Expander | `expander/` | Collapsible sections: media player, world clock |
| Notification list | `notificationList.tsx` | Recent notifications (compact) |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Main quick control | Boolean controls reconcile checked state to the backend; Theme/Profile cycle values without checked state; idle Timer opens options and active Timer cancels |
| I2 | Adjust brightness slider | Updates `Brightness.screen` reactively |
| I3 | Adjust audio slider | Updates Wireplumber speaker/mic volume |
| I4 | Click tray icon | Opens that service's context menu |
| I5 | Click notification in list | Expands/handles the notification |
| I6 | Click outside QS | QS closes |
| I7 | Sleep prevention: Indefinitely | Clear the finite countdown and retain/activate the inhibitor; Off releases it; duration zero remains Off |
| I8 | Power options | Lock/Suspend remain immediate; Log Out/Restart/Power Off require an explicit native dialog with Cancel as default/close response. Close the originating popover first; release its layer grab for the dialog; return focus only to a still-mapped parent after compositor ownership. Hiding/destroying the parent cancels without action |
| I9 | Saved display layout | Preview a transaction; current committed layout is text, not a checked-looking preview command |
| I10 | Bluetooth hotplug/power | Selected adapter add/remove and native powered notifications refresh the tile's checked state/value; the main action changes that adapter, while opening its options does not |

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
- **Native confirmation regression**: a harmless callback counter covers duplicate
  opens and explicit confirmation from an Astal parent. Fallback `closed` may
  precede `response`; cleanup must not consume the later valid response.
