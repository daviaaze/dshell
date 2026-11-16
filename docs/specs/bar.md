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
| Start: launcher/system usage; center: monitor workspaces/window title; end: Bluetooth/audio, recording, screen sharing, tray applications, clock, weather, and system indicators | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Workspace app icons update when Hyprland finishes populating a client's class or title | [`workspaces.tsx`](../../packages/widgets/src/bar/workspaces.tsx) |
| Position determines window anchor and horizontal/vertical orientation | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Vertical clock face uses four rows; horizontal placement preserves the horizontal face, and the active timer remains a single label | [`clock.tsx`](../../packages/widgets/src/bar/clock.tsx) |
| Each monitor's bar unregisters and closes on cleanup | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Bar module visibility is controlled by settings | [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts) |
| Vertical width is bounded by a 48-logical-pixel native scroll viewport, shared with launcher/Quick Settings edge reservations | [`geometry.ts`](../../packages/widgets/src/bar/geometry.ts), [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Vertical title/recording/Bluetooth content stacks; long values use bounded labels and full-value tooltips; month is abbreviated | Bar leaf components |
| Vertical usage/indicator buttons remove horizontal native padding; usage labels stay bounded with full-value tooltips at enlarged fonts | [`systemUsage.tsx`](../../packages/widgets/src/bar/systemUsage.tsx), [`systemIndicators.tsx`](../../packages/widgets/src/bar/systemIndicators.tsx) |
| Focused-client title/class changes update the bounded label and tooltip without requiring a different focused window | [`windowTitle.tsx`](../../packages/widgets/src/bar/windowTitle.tsx) |
| The bar's long-axis content scrolls inside the compositor-allotted layer; the 48px width/height is the reserved cross-axis size, not a promise that every vertically stacked control fits a short output simultaneously | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |
| Tray applications appear on the bar by default; IDs listed in `hidden-tray-items` appear only in Quick Settings. Per-item placement is controlled in Bar settings | [`index.tsx`](../../packages/widgets/src/bar/index.tsx), [`quicksettings/tray.tsx`](../../packages/widgets/src/quicksettings/tray.tsx), [`bar.tsx`](../../packages/widgets/src/settings/bar.tsx), [`bar.gschema.ts`](../../packages/services/src/settings/bar.gschema.ts) |
| External screen sharing stays visible while a real XDPH `Video/Source` node is running; its popover identifies the application and source when PipeWire metadata provides them. Audio, webcams, and picker previews do not activate it | [`screencast.ts`](../../packages/services/src/capture/screencast.ts), [`screencastGraph.ts`](../../packages/services/src/capture/screencastGraph.ts), [`indicators/screencast.tsx`](../../packages/widgets/src/bar/indicators/screencast.tsx) |


Component-specific interactions and fallback behavior should be verified in the owning component before adding them here.

The portal backend publishes source kind/name and its requesting app ID on the existing PipeWire stream. If an application supplies no ID, the observer uses the linked consumer application's metadata when available; otherwise the UI explicitly leaves it unidentified. Existing streams are discovered at service startup, and stopping/removing a stream clears its indicator. This is separate from the shell's own recording timer and stop action. Updated portal metadata requires deploying the patched XDPH package; older backends still produce an honest generic activity indicator.


## Visual (Adwaita alignment)

| Element | Current class / native variable | Source |
|---------|---------------------------------|--------|
| Bar window | `card`, `background`; `@window_bg_color` in the window CSS | [`index.tsx`](../../packages/widgets/src/bar/index.tsx) |

The shared theme maps its palette onto native Adwaita CSS variables, including `--window-bg-color`, `--window-fg-color`, `--accent-bg-color`, `--accent-fg-color`, `--accent-color`, `--card-bg-color`, and `--shade-color`. See [`theme.ts`](../../packages/style/src/theme.ts) and the [GTK4/libadwaita style guide](../STYLEGUIDE.md). This is not a claim that the bar uses every variable directly.

## Test plan

- **Functional/manual**: inspect bar position, enabled modules, workspaces, and monitor add/remove behavior against the current source and runtime.
- **Visual/manual**: inspect horizontal and vertical layouts in supported color schemes. No current screenshot baseline or runtime verification is asserted here.