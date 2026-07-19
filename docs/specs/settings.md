# Spec: Settings

> Multi-page preferences window using Adw.PreferencesWindow.

## Overview

- **Source**: `src/widget/settings/` (entry: `index.tsx`, plus pages: `appearance.tsx`, `bar.tsx`, `clock.tsx`, `debug.tsx`, `idle.tsx`, `network.tsx`, `notifications.tsx`, `screenCapture.tsx`, `timer.tsx`, `weather.tsx`)
- **Settings groups**: All from `src/lib/settings/schema.ts` (general, bar, weather, timer, screenCapture)
- **Type**: `Adw.PreferencesWindow`, standalone Adw window (not a shell overlay); created via exported `createSettingsWindow()`

## Functional

### Pages

| # | Page | Source | Contents |
|---|------|--------|----------|
| P1 | Appearance | `appearance.tsx` | Wallpaper day/night picker, color scheme, font settings |
| P2 | Bar & Dock | `bar.tsx` | Bar position, modules visibility toggles, dock pinned apps, icon size |
| P3 | Idle & Lock | `idle.tsx` | Auto-lock timeout, lock screen options |
| P4 | Notifications | `notifications.tsx` | Sound alerts, history limit, progress bars, ignored apps |
| P5 | Screen Capture | `screenCapture.tsx` | Recording format/quality, boundary color, screenshot save dir |
| P6 | Network | `network.tsx` | WiFi networks, connection management (captive portal?) |
| P7 | Clock & Weather | `clock.tsx`, `weather.tsx` | Timezone, world clocks; weather units, location, API key |
| P8 | Timer | `timer.tsx` | Timer presets, alarms |
| P9 | Debug | `debug.tsx` | Debug logging categories, level |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Navigate via sidebar | Adw.PreferencesWindow handles page switching |
| I2 | Toggle a switch | Corresponding GSettings key updated immediately |
| I3 | Pick a file (wallpaper) | Gtk.FileChooser opens; path saved to GSettings |
| I4 | Search settings | `searchEnabled=true` on PreferencesWindow; Adw search bar |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Application not set | PreferencesWindow application set to `app` from shell's App; if called outside shell context, window is standalone |
| E2 | GSettings key not writable | Settings write silently fails (GSettings default behavior) |
| E3 | Multiple settings windows | Not prevented — each call to `createSettingsWindow()` creates a new window |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `Adw.PreferencesWindow` with `background` class | Adw native window |
| Pages | `Adw.PreferencesPage` with `iconName` | Standard Adw components |
| Rows | `Adw.ActionRow`, `Adw.ComboRow`, `Adw.SwitchRow` | Standard Adw widgets |

### Adwaita checklist

- [x] Uses `Adw.PreferencesWindow` and standard Adw widgets throughout
- [x] Each page has a symbolic icon
- [x] Search enabled
- [x] Verified in light and dark — native Adw theming

## Test plan

- **Unit**: each page is declarative; test GSettings read/write round-trip for each setting
- **Compliance linter**: `network.tsx` oversized (627 lines), get_default in JSX warnings; hardcoded color in screenCapture
- **Visual/manual**: open each page; toggle every switch; pick wallpaper; search settings; close and reopen
