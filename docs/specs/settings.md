# Spec: Settings

> Source-linked reference to the current Settings implementation. Source descriptions are not claims of runtime verification.


## Overview

- **Source**: [`packages/widgets/src/settings/`](../../packages/widgets/src/settings/) (page composition: [`index.tsx`](../../packages/widgets/src/settings/index.tsx); lazy lifecycle: [`settingsOpen.ts`](../../packages/widgets/src/settings/settingsOpen.ts))
- **Settings groups**: settings components use the relevant schemas and services under [`packages/services/src/`](../../packages/services/src/).
- **Type**: `Adw.PreferencesWindow`, rendered lazily when Settings is opened.
- `openSettings()` presents the existing window if it is visible. If an existing window is not visible, it closes and clears that instance, disposes its rendered tree, then renders and presents a new window. The close-request handler disposes the current rendered tree.

## Functional

### Pages

| # | Page | Current page content sources | Contents |
|---|------|-------------------------------|----------|
| P1 | Appearance | [`appearance.tsx`](../../packages/widgets/src/settings/appearance.tsx) | Appearance and wallpaper controls |
| P2 | Displays | [`displays.tsx`](../../packages/widgets/src/settings/displays.tsx) | Display controls |
| P3 | Bar & Dock | [`bar.tsx`](../../packages/widgets/src/settings/bar.tsx) | Bar and dock preferences |
| P4 | Idle & Lock | [`idle.tsx`](../../packages/widgets/src/settings/idle.tsx), [`power.tsx`](../../packages/widgets/src/settings/power.tsx) | Idle and power/lock preferences |
| P5 | Notifications | [`notifications.tsx`](../../packages/widgets/src/settings/notifications.tsx), [`scheduledDND.tsx`](../../packages/widgets/src/settings/scheduledDND.tsx) | Notification and scheduled DND preferences |
| P6 | Screen Capture | [`screenCapture.tsx`](../../packages/widgets/src/settings/screenCapture.tsx), [`screenShare.tsx`](../../packages/widgets/src/settings/screenShare.tsx) | Capture and screen-sharing preferences |
| P7 | Network | [`network.tsx`](../../packages/widgets/src/settings/network.tsx) | Network preferences |
| P8 | Bluetooth | [`bluetooth.tsx`](../../packages/widgets/src/settings/bluetooth.tsx) | Bluetooth devices and adapter controls |
| P9 | Clock & Weather | [`clock.tsx`](../../packages/widgets/src/settings/clock.tsx), [`weather.tsx`](../../packages/widgets/src/settings/weather.tsx) | Clock and weather preferences |
| P10 | Timer | [`timer.tsx`](../../packages/widgets/src/settings/timer.tsx) | Timer preferences |
| P11 | Sound | [`sound.tsx`](../../packages/widgets/src/settings/sound.tsx) | Sound preferences |
| P12 | Mouse & Touchpad | [`mouse.tsx`](../../packages/widgets/src/settings/mouse.tsx) | Pointer and touchpad preferences |
| P13 | Keyboard Shortcuts | [`shortcuts.tsx`](../../packages/widgets/src/settings/shortcuts.tsx) | Shortcut reference |
| P14 | Default Apps | [`defaultApps.tsx`](../../packages/widgets/src/settings/defaultApps.tsx) | Default application preferences |
| P15 | Startup Apps | [`startupApps.tsx`](../../packages/widgets/src/settings/startupApps.tsx) | Startup application preferences |
| P16 | About | [`about.tsx`](../../packages/widgets/src/settings/about.tsx) | Application information |
| P17 | Debug | [`debug.tsx`](../../packages/widgets/src/settings/debug.tsx) | Debug controls |


### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | Navigate via sidebar | `Adw.PreferencesWindow` provides page navigation |
| I2 | Search settings | `searchEnabled=true` enables built-in preferences search |

### Lifecycle notes

- Page titles and component composition follow [`index.tsx`](../../packages/widgets/src/settings/index.tsx); Bluetooth supplies its own `Adw.PreferencesPage` from `bluetooth.tsx`.
- Settings is a lazy widget; its open action calls `openSettings()` to render the window on demand. The lifecycle behavior above follows [`settingsOpen.ts`](../../packages/widgets/src/settings/settingsOpen.ts).
- This table identifies page composition, not per-control persistence or service behavior. Check the relevant page and service before describing those details.


## Visual (Adwaita alignment)

The window is an `Adw.PreferencesWindow` with the `background` CSS class. Its pages use `Adw.PreferencesPage` and symbolic icon names; built-in search is enabled. Individual page controls use their respective Adwaita widgets. See [`index.tsx`](../../packages/widgets/src/settings/index.tsx) and the [GTK4/libadwaita style guide](../STYLEGUIDE.md).

## Test plan

- **Functional/manual**: when running the application, inspect navigation and search and compare page behavior with its current implementation. This spec does not assert runtime verification.
- **Visual/manual**: inspect the preferences window in the supported color schemes; no screenshot baseline is asserted here.
