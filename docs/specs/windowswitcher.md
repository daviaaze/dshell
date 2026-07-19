# Spec: WindowSwitcher

> Alt+Tab window switcher with MRU ordering, keyboard navigation, and Alt-key dismiss.

## Overview

- **Source**: `src/widget/windowswitcher/` (entry: `index.tsx`)
- **Dependencies**: `AstalHyprland`, `WindowManager`
- **Type**: `Astal.Window`, layer `OVERLAY`, keymode `EXCLUSIVE`, covers entire monitor; toggled via exported `toggleWindowSwitcher()` function

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Hidden | Default | Window hidden; no MRU tracking active for navigation |
| F2 | Shown | `toggleWindowSwitcher()` called | Window visible; clients list populated and sorted by MRU; selected index = 1 (second item = previously focused); focus grabbed on the inner box |
| F3 | Empty / no windows | Hyprland has zero clients | `Adw.StatusPage` with "No Open Windows" displayed; keyboard actions are no-ops |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Tab / Right arrow | Advance selection forward (wraps around) |
| I2 | Shift+Tab / Left arrow | Move selection backward (wraps) |
| I3 | Enter / KP_Enter | Focus the selected client |
| I4 | Escape | Close switcher without focusing |
| I5 | Q | Kill the selected client |
| I6 | Super/Meta key released | Focus selected client and close switcher |
| I7 | Super held (no other key) | Switcher stays open; selection unchanged |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Client closes while switcher open | Selection index clamped to valid range; list updates reactively |
| E2 | Super released with no clients | Switcher closes, no-op |
| E3 | Switcher shown with < 2 clients | Only one item; Tab wraps to same item; Enter selects only client |
| E4 | Monitor focus changes | Switcher follows `focusedMonitor` |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window background | Inline `css` (`background-color: transparent;`) | Transparent; no theme color needed |
| Item container | `box` with | Uses `SwitcherItem` component |
| Status page | `compact` on `Adw.StatusPage` | Custom compact variant |

### Adwaita checklist

- [ ] Window transparent — intentional (overlay)
- [x] Status page uses symbolic icon
- [x] Label classes: `title-2`, `caption`
- [ ] Verify in light and dark variants

## Test plan

- **Unit**: extract and test `getSortedClients` MRU sorting logic, selection index clamping
- **Compliance linter**: no expected violations
- **Visual/manual**: screenshots with 1 client, 5+ clients, empty state
