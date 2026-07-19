# Spec: Wallpaper

> Per-monitor wallpaper with automatic day/night switching.

## Overview

- **Source**: `src/widget/wallpaper/` (entry: `index.tsx`)
- **Settings group**: `generalSchema` — `wallpaperDay`, `wallpaperNight`
- **Type**: One `Astal.Window` per monitor, layer `BACKGROUND`, exclusivity `IGNORE`, anchored to all four edges

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Day wallpaper | `ColorScheme.daytime` = true and mode = AUTO, or mode = LIGHT | `Gtk.Picture` shows `settings.wallpaperDay` |
| F2 | Night wallpaper | `ColorScheme.daytime` = false and mode = AUTO, or mode = DARK | `Gtk.Picture` shows `settings.wallpaperNight` |
| F3 | Wallpaper file changed | `settings.wallpaperDay/wallpaperNight` updated in GSettings | Picture updates reactively via binding |
| F4 | ColorScheme changes | `ColorScheme.colorScheme` switches LIGHT/DARK/AUTO | Computed wallpaper swaps between day/night files |
| F5 | Monitor hotplug | Monitor added/removed | Bar per monitor via `For each={monitors}`; removed on `onCleanup` |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | — | No user interaction points; wallpaper is purely visual |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Wallpaper file doesn't exist | `Gtk.Picture` with `Gio.File` to nonexistent path — shows blank/placeholder |
| E2 | Settings for both day and night are identical | No visual change during switch |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Picture | `Gtk.Picture` `contentFit=COVER` | No CSS — fills window completely |
| Window | No CSS classes | Background layer, no theme chrome |

### Adwaita checklist

- [ ] No hardcoded colors or custom CSS — purely image-based
- [x] Content-fit cover fills monitor correctly
- [x] Verified in light and dark

## Test plan

- **Unit**: test `createComputed` logic choosing day vs night wallpaper based on ColorScheme state
- **Compliance linter**: no expected violations
- **Visual/manual**: screenshots of day and night wallpapers; monitor hotplug test
