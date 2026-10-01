# Spec: Bar

> Source-linked reference for the shell bar. The current implementation is authoritative; source tracing is not runtime verification.


## Overview

- **Source**: [`packages/widgets/src/bar/`](../../packages/widgets/src/bar/) (entry: [`index.tsx`](../../packages/widgets/src/bar/index.tsx))
- **Settings group**: [`barSettings`](../../packages/services/src/settings/bar.gschema.ts)
- **Layer/behavior**: `index.tsx` creates one exclusive `Astal.Window` for each GDK monitor, anchored to the selected edge and registered with `WindowManager`.


## Functional

### Current composition and adaptation

| Behavior | Source evidence |
|---|---|
| Start: launcher/system usage; center: monitor workspaces/window title; end: Bluetooth/audio, recording, clock, weather, and system indicators | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Workspace app icons update when Hyprland finishes populating a client's class or title | [`workspaces.tsx`](../../packages/widgets/src/bar/workspaces.tsx) |
| Position determines window anchor and horizontal/vertical orientation | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Vertical clock face uses four rows; horizontal placement preserves the horizontal face, and the active timer remains a single label | [`clock.tsx`](../../packages/widgets/src/bar/clock.tsx) |
| Each monitor's bar unregisters and closes on cleanup | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Bar module visibility is controlled by settings | [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts) |


Component-specific interactions and fallback behavior should be verified in the owning component before adding them here.


## Visual (Adwaita alignment)

| Element | Current class / native variable | Source |
|---------|---------------------------------|--------|
| Bar window | `card`, `background`; `@window_bg_color` in the window CSS | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |

The shared theme maps its palette onto native Adwaita CSS variables, including `--window-bg-color`, `--window-fg-color`, `--accent-bg-color`, `--accent-fg-color`, `--accent-color`, `--card-bg-color`, and `--shade-color`. See [`theme.ts`](../../packages/style/src/theme.ts) and the [GTK4/libadwaita style guide](../STYLEGUIDE.md). This is not a claim that the bar uses every variable directly.

## Test plan

- **Functional/manual**: inspect bar position, enabled modules, workspaces, and monitor add/remove behavior against the current source and runtime.
- **Visual/manual**: inspect horizontal and vertical layouts in supported color schemes. No current screenshot baseline or runtime verification is asserted here.
