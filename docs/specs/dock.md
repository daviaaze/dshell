# Spec: Dock

> Pinned and running apps taskbar at the bottom of the screen.

## Overview

- **Source**: `src/widget/dock/` (entry: `index.tsx`)
- **Settings group**: `barSchema` — `dockEnabled`, `dockPinnedApps`, `dockIconSize`
- **Type**: `Astal.Window`, layer `TOP`, anchor BOTTOM|LEFT|RIGHT, exclusivity `NORMAL` (pushes windows away), registered in `WindowManager`

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Enabled/disabled | `bar.dockEnabled` toggle | Window shown/hidden |
| F2 | Pinned items | `bar.dockPinnedApps` array | Desktop files shown in order; icon size from `bar.dockIconSize` |
| F3 | Running apps | Hyprland client added/removed (any window) | Running (non-pinned) apps appended after pinned items |
| F4 | Active app focus | `hyprland.focusedClient` changes | The app whose client address matches gets `active: true`; status indicator changes |
| F5 | Hover | Mouse hovers over inactive dock item | Standard GTK hover highlight (Adw `flat` + `circular` classes) |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Left-click on running app | Focuses its first client window |
| I2 | Left-click on pinned non-running app | Launches via `gtk-launch <desktopFile>` |
| I3 | Right-click on any item | Opens popover menu with Focus (if running), Close (if running), Pin/Unpin |
| I4 | Click close in popover | Kills all clients of that app (`client.kill()`) |
| I5 | Click pin/unpin in popover | Adds/removes desktop file from `bar.dockPinnedApps` settings array |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | App lauched via dock then closes | Item stays pinned if pinned; removed if it was a recently-closed running app |
| E2 | Multiple windows for same app | One dock item shown; left-click focuses first client; popover close kills all |
| E3 | `dockPinnedApps` contains files no longer installed | Item shows generic `application-x-executable-symbolic` icon; click tries `gtk-launch` and fails silently |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Dock container | `Gtk.Box`, `spacing={8}`, `.linked` + `.card` + `.background` | Current widget classes; no explicit custom radius declared |
| Status indicator | `status-active` / `status-running` classes | Applied to the indicator in `item.tsx`; avoid undocumented `--shade-*` tokens |
| Icon size | `bar.dockIconSize` | Reactive setting |
| Button shape | `flat` + `circular` | Adw classes |

### Adwaita checklist

- [x] Uses `flat` + `circular` button style classes
- [x] Container uses `.card`; no custom radius token is declared
- [x] Icons are symbolic
- [x] Verified in light and dark

## Test plan

- **Unit**: extract and test dock item computation from pinned + running + focus state
- **Compliance linter**: `get_default` in JSX
- **Visual/manual**: screenshots with pinned only, running only, mixed, and active state
