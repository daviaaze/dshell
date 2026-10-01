# Spec: Settings

> Multi-page preferences window using Adw.PreferencesWindow.

## Overview

- **Source**: `packages/widgets/src/settings/` (entry: `index.tsx`; window lifecycle: `settingsOpen.ts`; page components are colocated)
- **Settings groups**: owned by settings/services schemas under `packages/services/src/settings/`; each page also uses the relevant service API
- **Type**: `Adw.PreferencesWindow`, opened lazily from the shell. `openSettings()` presents an already-visible window or disposes a stale instance before creating and presenting one.

## Functional

### Pages

| # | Page | Source | Contents |
|---|------|--------|----------|
| P1 | Appearance | `appearance.tsx` | Theme, wallpaper and appearance controls |
| P2 | Displays | `displays.tsx` | Monitor and display-layout controls |
| P3 | Bar & Dock | `bar.tsx` | Bar modules/position and dock preferences |
| P4 | Idle & Lock | `idle.tsx`, `power.tsx` | Idle and power/lock preferences |
| P5 | Notifications | `notifications.tsx`, `scheduledDND.tsx` | Notification and scheduled DND preferences |
| P6 | Screen Capture | `screenCapture.tsx`, `screenShare.tsx` | Capture and screen-sharing preferences |
| P7 | Network | `network.tsx` | Network controls |
| P8 | Bluetooth | `bluetooth.tsx` | Bluetooth controls |
| P9 | Clock & Weather | `clock.tsx`, `weather.tsx` | Clock and weather preferences |
| P10 | Timer | `timer.tsx` | Timer preferences |
| P11 | Sound | `sound.tsx` | Audio preferences |
| P12 | Mouse & Touchpad | `mouse.tsx` | Pointer and touchpad preferences |
| P13 | Keyboard Shortcuts | `shortcuts.tsx` | Shortcut reference |
| P14 | Default Apps | `defaultApps.tsx` | Default application choices |
| P15 | Startup Apps | `startupApps.tsx` | Startup application choices |
| P16 | About | `about.tsx` | Application information |
| P17 | Debug | `debug.tsx` | Debug controls |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Navigate via sidebar | `Adw.PreferencesWindow` provides page navigation |
| I2 | Search settings | `searchEnabled=true` enables built-in preferences search |

### Lifecycle notes

- The page grouping and titles above follow `packages/widgets/src/settings/index.tsx`.
- Settings window creation/presentation is managed by `packages/widgets/src/settings/settingsOpen.ts`; it presents a visible existing window, and closes/disposes a stale existing instance before recreating it.
- This index describes page composition, not the persistence model of each control. Confirm the relevant page and service/schema before asserting whether a setting takes effect immediately, is saved, or requires another action.

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Window | `Adw.PreferencesWindow` with `background` class | Native Adwaita window |
| Pages | `Adw.PreferencesPage` with symbolic `iconName` | Standard Adwaita navigation |
| Rows | Adwaita preference rows | Use the row types chosen by each page |

### Adwaita checklist

- [x] Uses `Adw.PreferencesWindow` and standard Adwaita preference pages
- [x] Page icons are symbolic
- [x] Search is enabled
- [ ] Verify light and dark appearance on the running application

## Test plan

- **Functional/manual**: open the window, navigate/search the current page list, and verify behavior against each page's implementation and service.
- **Visual/manual**: inspect the preferences window in light and dark schemes. This checklist does not claim a recent runtime verification.
