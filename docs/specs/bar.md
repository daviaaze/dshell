# Spec: Bar

> Source-linked reference for the shell bar. Verify behavior against the current implementation before treating older detail as a contract.

## Overview

- **Source**: `packages/widgets/src/bar/` (entry: `index.tsx`)
- **Settings group**: `barSettings` in `packages/services/src/settings/bar.gschema.ts`
- **Layer/behavior**: one `Astal.Window` per GDK monitor; anchored to the selected edge, exclusive, and registered with `WindowManager`

## Functional

### Current composition and adaptation

| Behavior | Source evidence |
|---|---|
| Start slot contains launcher and system usage; center contains monitor workspaces and window title; end contains Bluetooth/audio, recording, clock, weather, and system indicators | `bar/index.tsx` |
| Workspace app icons update when Hyprland finishes populating a client's class or title | `workspaces.tsx` |
| Position determines window anchor and horizontal/vertical orientation | `bar/index.tsx` |
| Clock uses four rows (hour, minute, day, localized month) when the bar is vertical; horizontal placement preserves the existing horizontal face, and the active timer remains a single label | `bar/clock.tsx` |
| The bar is rendered for each current monitor and unregisters/closes its window on cleanup | `bar/index.tsx` |
| Visibility settings include bar modules and dock preferences | `packages/services/src/settings/bar.gschema.ts` |

Component-specific interactions and fallback behavior should be verified in the owning component before adding them here.

## Visual (Adwaita alignment)

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Bar window | `card` + `background`; `@window_bg_color` | Current root window classes/background in `bar/index.tsx` |
| Start/end groups | `linked` | Adwaita linked groups |
| Workspaces/indicators | Component-specific Adwaita classes | Verify the owning component before adding a token contract |

### Adwaita checklist

- [x] Current bar root uses Adwaita `card`/`background` classes and a native window color
- [x] Start/end groups use the `linked` class
- [ ] Verify light/dark variants and both orientations on the running application


## Test plan

- **Functional/manual**: inspect bar position, enabled modules, workspaces, and monitor add/remove behavior against the current source and runtime.
- **Visual/manual**: inspect horizontal and vertical layouts in light and dark schemes. No current screenshot baseline is asserted here.
