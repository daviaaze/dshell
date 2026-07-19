# Spec: RecordingBoundary

> Dashed-border overlay showing the recording/capture area boundary during selection.

## Overview

- **Source**: `src/widget/recording-boundary/` (entry: `index.tsx`)
- **Dependencies**: `Screenshot` service (`boundaryGeometry`, `boundary-visible` properties), `getScreenCaptureSettings`
- **Type**: One `Astal.Window` per monitor, layer `OVERLAY`, anchored to all four edges, exclusivity `IGNORE`; visible when `Screenshot['boundary-visible']` is true

## Functional

### States

| # | State | Trigger | Expected behavior |
|---|-------|---------|-------------------|
| F1 | Hidden | No boundary active | All per-monitor windows hidden |
| F2 | Boundary visible | `ss['boundary-visible']` = true | For each monitor, dashed border drawn at the boundary geometry position (clipped to monitor); uses color from `recordingBoundaryColor` setting |

### Interactions

| # | Action | Expected behavior |
|---|--------|-------------------|
| I1 | — | No user interaction points |

### Edge cases

| # | Condition | Expected behavior |
|---|-----------|-------------------|
| E1 | Boundary spans multiple monitors | Each monitor only draws the portion of the boundary visible on it (clipped via Cairo) |
| E2 | Boundary geometry null | No drawing; `draw_func` guard returns early without stroke |
| E3 | No monitors available | No windows created |

## Visual (Adwaita alignment)

### Theme tokens

| Element | Token / style class | Notes |
|---------|--------------------|-------|
| Boundary border | Cairo drawing: `dashed [8,4]`, 3px width | Dashed, not CSS — appropriate for overlay |
| Border color | From `captureSettings.recordingBoundaryColor()` default `#FF0000` | User-configurable setting; default is red |
| Line cap | `Cairo.LineCap.SQUARE` | Standard for dashed selection |

### Adwaita checklist

- [ ] Cairo drawn — no CSS theme tokens expected
- [x] Boundary color is user-configurable (settings, not hardcoded)

## Test plan

- **Unit**: test `rectOverlap` geometry logic, `drawBoundaryForMonitor` clipping math, `parseColor` hex parsing
- **Compliance linter**: no expected violations (Cairo draw, no CSS)
- **Visual/manual**: test boundary on single monitor, spanning two monitors, at screen edge
